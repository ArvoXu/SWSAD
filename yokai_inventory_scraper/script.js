document.addEventListener('DOMContentLoaded', function () {
    // --- Element Selections ---
    // Note: legacy controls (clearButton, clearStorageButton, rawData textarea,
    // download/export buttons) have been removed from the DOM and their
    // handlers pruned from this script to avoid runtime errors.
    const outputTableDiv = document.getElementById('outputTable');
    const editDialog = document.getElementById('editDialog');
    const closeDialogButton = document.querySelector('.close');
    const saveNoteButton = document.getElementById('saveNoteButton');
    const autoUpdateButton = document.getElementById('autoUpdateButton');
    const searchInput = document.getElementById('searchInput');
    const viewAsCardButton = document.getElementById('viewAsCardButton');
    const viewAsListButton = document.getElementById('viewAsListButton');
    const outputListDiv = document.getElementById('outputList');
    const updateTimeInput = document.getElementById('updateTimeInput');
    const importSalesButton = document.getElementById('importSalesButton');
    const salesFileInput = document.getElementById('salesFileInput');
    const monthSelectionDialog = document.getElementById('monthSelectionDialog');
    const monthSelect = document.getElementById('monthSelect');
    const confirmMonthButton = document.getElementById('confirmMonthButton');
    const cancelMonthButton = document.getElementById('cancelMonthButton');
    const monthDialogCloseButton = monthSelectionDialog.querySelector('.close');
    const openChartWindowButton = document.getElementById('openChartWindowButton');
    const autoUpdateSalesButton = document.getElementById('autoUpdateSalesButton');
    // uploadInventoryFileButton removed from DOM; use inventoryFileInput element and dropzone instead
    const inventoryFileInput = document.getElementById('inventoryFileInput');
    const warehouseFileInput = document.getElementById('warehouseFile');
    const warehouseUploadBtn = document.getElementById('warehouseUploadBtn');
    const warehouseFileName = document.getElementById('warehouseFileName');
    const warehouseUploadStatus = document.getElementById('warehouseUploadStatus');
    
    // --- Global State ---
    let currentView = 'card';
    let storeGroupsArray = [];
    let currentSort = { key: 'store', order: 'asc' };
    let currentEditingStore = null;
    let savedInventoryData = []; // Single source of truth for data from the server
    // guard to ensure we only add one global click listener for action menus
    let _userActionMenuListenerAdded = false;

    // --- Warehouse File Upload Handling ---
    // Wire up new dropzones and inputs
    const warehouseDropzone = document.getElementById('warehouseDropzone');
    const inventoryDropzone = document.getElementById('inventoryDropzone');
    const salesDropzone = document.getElementById('salesDropzone');
    const warehouseFileInputEl = document.getElementById('warehouseFile');
    const inventoryFileInputEl = document.getElementById('inventoryFileInput');
    const salesFileInputEl = document.getElementById('salesFileInput');

    function preventDefault(e) { e.preventDefault(); e.stopPropagation(); }

    // Common drop handling helper
    function setupDropzone(dropEl, inputEl, handler) {
        if (!dropEl || !inputEl) return;
        dropEl.addEventListener('click', () => inputEl.click());
    ['dragenter','dragover'].forEach(evt => dropEl.addEventListener(evt, (ev)=>{ preventDefault(ev); dropEl.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(evt => dropEl.addEventListener(evt, (ev)=>{ preventDefault(ev); dropEl.classList.remove('dragover'); }));
    dropEl.addEventListener('drop', (ev) => {
            const dt = ev.dataTransfer;
            if (dt && dt.files && dt.files.length > 0) {
                handler(dt.files[0]);
            }
        });
        inputEl.addEventListener('change', (ev) => {
            const f = ev.target.files && ev.target.files[0];
            if (f) handler(f);
        });
    }

    // Handlers reusing existing upload functions
    setupDropzone(warehouseDropzone, warehouseFileInputEl, async (file) => {
        const wf = document.getElementById('warehouseFileName'); if (wf) wf.textContent = file.name;
        const statusEl = document.getElementById('warehouseUploadStatus'); if (statusEl) { try { statusEl.textContent = '正在上傳...'; statusEl.style.color = '#666'; } catch (e) {} }
        const fd = new FormData(); fd.append('file', file);
        try {
            const resp = await fetch('/upload-warehouse-file', { method: 'POST', body: fd });
            // try to parse body safely
            let json = null;
            try { json = await resp.json(); } catch(e) { json = null; }
            if (!resp.ok) {
                const text = json && json.message ? json.message : `${resp.status} ${resp.statusText}`;
                throw new Error(text || '上傳失敗');
            }
            if (json && json.success === false) throw new Error(json.message || '上傳失敗');
            if (statusEl) { try { statusEl.textContent = '上傳成功！'; statusEl.style.color = '#4CAF50'; } catch(e) {} }
            if (typeof fetchAndDisplayData === 'function') {
                try { await fetchAndDisplayData(); } catch(e) { console.warn('fetchAndDisplayData failed:', e); }
            }
        } catch (err) {
            console.error('warehouse upload error', err);
            if (statusEl) {
                try { statusEl.textContent = `上傳失敗: ${err.message}`; statusEl.style.color = '#f44336'; } catch(e) {}
            }
        }
    });

    setupDropzone(inventoryDropzone, inventoryFileInputEl, async (file) => {
        // validate .json
        if (!file.name.endsWith('.json')) { alert('請上傳 JSON 文件'); return; }
        const fd = new FormData(); fd.append('file', file);
        try {
            const upBtn = document.getElementById('uploadInventoryFileButton'); if (upBtn) upBtn.disabled = true;
            const resp = await fetch('/upload-inventory-file', { method: 'POST', body: fd });
            const json = await resp.json();
            if (json.success) { alert('庫存文件上傳成功'); await fetchAndDisplayData(); await loadUpdateLogs(); }
            else throw new Error(json.message || '上傳失敗');
    } catch (err) { alert('上傳失敗: ' + err.message); }
    finally { const upBtn2 = document.getElementById('uploadInventoryFileButton'); if (upBtn2) upBtn2.disabled = false; }
    });

    // Sales upload handler with simple debounce to avoid duplicate uploads
    let _salesUploadInProgress = false;
    setupDropzone(salesDropzone, salesFileInputEl, async (file) => {
        if (_salesUploadInProgress) {
            console.log('sales upload already in progress, ignoring duplicate trigger');
            return;
        }
        _salesUploadInProgress = true;
        try {
            await processSalesFile(file);
        } catch (err) {
            console.error('sales upload error', err);
        } finally {
            // small delay to avoid immediate retrigger if browser fires events twice
            setTimeout(() => { _salesUploadInProgress = false; }, 500);
        }
    });

    // --- Core Functions: Data Handling and Rendering ---

    async function fetchAndDisplayData() {
        try {
            const response = await fetch('/get-data');
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || '從伺服器獲取數據失敗');

            savedInventoryData = result.data;
            updateLatestTime(savedInventoryData);
                displayResults(savedInventoryData);
            console.log('成功從伺服器獲取並顯示數據。');
        } catch (error) {
            console.error('獲取數據時發生網絡錯誤:', error);
            outputTableDiv.innerHTML = `<p style="color: red;">無法從伺服器加載數據: ${error.message}</p>`;
        }
    }

    function updateLatestTime(data) {
        if (!data || data.length === 0) return;
        const processTimes = data.map(item => item.processTime ? new Date(item.processTime).getTime() : 0).filter(time => time > 0);
        if (processTimes.length > 0) {
            const latestTimestamp = Math.max(...processTimes);
            if (updateTimeInput) {
                updateTimeInput.value = new Date(latestTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
            }
        }
    }

    function displayResults(data) {
        if (!data || data.length === 0) {
            outputTableDiv.innerHTML = '<p>沒有數據可顯示</p>';
            outputListDiv.innerHTML = '';
            storeGroupsArray = [];
            return;
        }
        
        const storeGroups = {};
        data.forEach(item => {
            const storeKey = getStoreKey(item);
            if (!storeGroups[storeKey]) {
                storeGroups[storeKey] = { ...item, processTime: item.processTime ? new Date(item.processTime) : null, products: [] };
            }
            storeGroups[storeKey].products.push({ name: item.productName, quantity: item.quantity });
        });

        storeGroupsArray = Object.values(storeGroups).map(group => ({
            ...group,
            totalQuantity: group.products.reduce((sum, p) => sum + p.quantity, 0)
        }));

        applyFiltersAndRender();
    }

    function applyFiltersAndRender() {
        let dataToRender = [...storeGroupsArray];
        const searchTerm = searchInput.value.trim().toLowerCase();
        if (searchTerm) {
            dataToRender = dataToRender.filter(group => 
                group.store.toLowerCase().includes(searchTerm) || 
                group.machineId.toLowerCase().includes(searchTerm)
            );
        }

        dataToRender.sort((a, b) => {
            const valA = a[currentSort.key];
            const valB = b[currentSort.key];
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            const comparison = typeof valA === 'string' ? valA.localeCompare(valB, 'zh-Hans-CN') : valA - valB;
            return currentSort.order === 'asc' ? comparison : -comparison;
        });

        renderViews(dataToRender);
        updateSortButtonsUI();
        }
        
    function renderViews(dataArray) {
        if (!dataArray || dataArray.length === 0) {
            outputTableDiv.innerHTML = '<p>沒有數據可顯示</p>';
            outputListDiv.innerHTML = '';
            return;
        }

        let maxProducts = Math.max(0, ...dataArray.map(g => g.products.length));
        let cardHtml = '<div class="multi-column-container">';
        let listHtml = '<div class="list-view-container">';
        
        dataArray.forEach(group => {
            const storeKey = getStoreKey(group);
            const isHidden = group.isHidden;
            const replenishmentCleanInfo = `補貨: ${group.lastUpdated ? group.lastUpdated.split(' ')[0] : 'N/A'} | 清潔: ${group.lastCleaned ? group.lastCleaned.split(' ')[0] : 'N/A'}`;
            
            let updateTimeHTML = '';
            if (group.processTime) {
                const diffDays = Math.ceil((new Date() - group.processTime) / (1000 * 60 * 60 * 24)) - 1;
                const color = diffDays >= 2 ? 'var(--danger-color)' : (diffDays === 1 ? 'var(--warning-color)' : 'var(--success-color)');
                updateTimeHTML = `<br><span style="color: ${color};">更新時間: ${group.processTime.toLocaleString('zh-TW')}</span>`;
            }

            cardHtml += `
                <div class="store-container compact-container ${isHidden ? 'is-hidden' : ''}">
                    <table class="compact-table">
                        <tr class="store-header">
                            <td colspan="3">
                                ${group.store} ${group.machineId}
                                <button class="hide-button" onclick="toggleHideStore('${storeKey}')">${isHidden ? '取消隱藏' : '隱藏'}</button>
                                <button class="edit-button" onclick="editStoreNotes('${storeKey}')">編輯</button>
                                <button class="delete-button" onclick="deleteStoreData('${storeKey}')">刪除</button>
                            </td>
                        </tr>
                        <tr><td colspan="3" class="compact-info">${replenishmentCleanInfo}${updateTimeHTML}</td></tr>
                        <tr>
                            <td colspan="3"><div class="info-box">
                                <div class="info-line">${group.address ? `地址: ${group.address}` : '&nbsp;'}</div>
                                <div class="info-line">${group.note ? `備註: ${group.note}` : '&nbsp;'}</div>
                            </div></td>
                        </tr>
                        <tr><th class="col-num">#</th><th>產品名稱</th><th class="col-qty">數量</th></tr>
                        ${group.products.map((p, i) => `<tr><td class="col-num">${i + 1}</td><td>${p.name}</td><td class="col-qty">${p.quantity}</td></tr>`).join('')}
                        ${Array(maxProducts - group.products.length).fill('<tr><td colspan="3">&nbsp;</td></tr>').join('')}
                        <tr class="total-row"><td colspan="2">總計</td><td class="col-qty">${group.totalQuantity}</td></tr>
                    </table>
                </div>`;
            
            // A simplified list view render
            listHtml += `<div class="list-item ${isHidden ? 'is-hidden' : ''}">${group.store} - ${group.machineId}</div>`;
        });

        outputTableDiv.innerHTML = cardHtml + '</div>';
        outputListDiv.innerHTML = listHtml + '</div>';
    }

    // --- User Interaction Handlers (API-driven) ---

        window.editStoreNotes = function(storeKey) {
            currentEditingStore = storeKey;
        const group = storeGroupsArray.find(g => getStoreKey(g) === storeKey);
        if (group) {
            document.getElementById('storeAddress').value = group.address || '';
            document.getElementById('storeNote').value = group.note || '';
            document.getElementById('storeSales').value = group.manualSales || '';
            editDialog.style.display = 'block';
        }
    };

    saveNoteButton.addEventListener('click', async function() {
        if (!currentEditingStore) return;
        const payload = {
            address: document.getElementById('storeAddress').value,
            note: document.getElementById('storeNote').value,
            manualSales: parseInt(document.getElementById('storeSales').value, 10) || 0
        };
        await updateStoreData(currentEditingStore, payload, '儲存');
    });

    window.toggleHideStore = async function(storeKey) {
        const group = storeGroupsArray.find(g => getStoreKey(g) === storeKey);
        if (!group) return;
        await updateStoreData(storeKey, { isHidden: !group.isHidden }, '更新隱藏狀態');
    };
    
    async function updateStoreData(storeKey, payload, actionName, silent = false) {
        try {
            const response = await fetch(`/api/stores/${storeKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            
            if (!silent) {
                alert(`${actionName}成功！`);
            }

            // In some cases, we refresh outside the loop (like in updateManualSales)
            if (actionName !== '儲存' && !silent) {
                 await fetchAndDisplayData();
            }
             if (actionName === '儲存') {
                editDialog.style.display = 'none';
                await fetchAndDisplayData();
            }

        } catch (error) {
            if (!silent) {
                alert(`${actionName}失敗: ${error.message}`);
            }
            console.error(`Error during ${actionName}:`, error);
        }
    }

    window.deleteStoreData = async function(storeKey) {
        if (confirm(`確定要從資料庫永久刪除機台 ${storeKey} 的所有相關資料嗎？此操作不可恢復。`)) {
            try {
                const response = await fetch(`/api/inventory/${storeKey}`, { method: 'DELETE' });
                const result = await response.json();
                if (!result.success) throw new Error(result.message);
                alert('資料已成功從資料庫刪除。');
                await fetchAndDisplayData();
            } catch (error) {
                alert(`刪除失敗: ${error.message}`);
                console.error('Error deleting store data:', error);
            }
        }
    };
    
    // --- Background Scraper Handling ---

    function pollScraperStatus(statusUrl, buttonElement, buttonText) {
        const statusCheckInterval = setInterval(async () => {
            try {
                const response = await fetch(statusUrl);
                const result = await response.json();
                
                if (result.status === 'running') {
                    buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${buttonText}執行中...`;
                } else {
                    clearInterval(statusCheckInterval);
                    if (result.status === 'success') {
                        buttonElement.innerHTML = `<i class="fas fa-check-circle"></i> ${buttonText}成功`;
                        alert(`${buttonText}成功！正在獲取最新資料...`);
                        await fetchAndDisplayData();
                    } else if (result.status === 'error') {
                        buttonElement.innerHTML = `<i class="fas fa-times-circle"></i> ${buttonText}失敗`;
                        alert(`${buttonText}失敗: ${result.last_run_output}`);
                    }
                    setTimeout(() => {
                        if(buttonElement) {
                            buttonElement.innerHTML = `一鍵更新${buttonText}`;
                            buttonElement.disabled = false;
                        }
                    }, 3000);
                }
        } catch (error) {
                console.error('輪詢狀態時出錯:', error);
                clearInterval(statusCheckInterval);
            }
        }, 5000);
    }

    // --- Event Listeners Setup ---
    if(autoUpdateButton) {
        autoUpdateButton.addEventListener('click', function() {
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 請求已發送...';
            this.disabled = true;
            fetch('/run-scraper', { method: 'POST' }).then(response => {
                if (response.status === 202) {
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 庫存更新執行中...';
                    pollScraperStatus('/scraper-status', this, '庫存更新');
                } else {
                    this.innerHTML = '一鍵更新庫存';
                    this.disabled = false;
                    alert('錯誤：無法啟動庫存更新，可能已在執行中。');
                }
            }).catch(err => {
                this.innerHTML = '一鍵更新庫存';
                this.disabled = false;
                alert(`啟動庫存更新失敗: ${err.message}`);
            });
        });
    }
    
    if(autoUpdateSalesButton) {
        autoUpdateSalesButton.addEventListener('click', function() {
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 請求已發送...';
            this.disabled = true;
            fetch('/run-sales-scraper', { method: 'POST' }).then(response => {
                if (response.status === 202) {
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 銷售額更新執行中...';
                    pollScraperStatus('/sales-scraper-status', this, '銷售額更新');
                } else {
                    this.innerHTML = '一鍵更新銷售額';
                    this.disabled = false;
                    alert('錯誤：無法啟動銷售額更新，可能已在執行中。');
                }
            }).catch(err => {
                this.innerHTML = '一鍵更新銷售額';
                this.disabled = false;
                alert(`啟動銷售額更新失敗: ${err.message}`);
            });
        });
    }

    if(searchInput) searchInput.addEventListener('input', applyFiltersAndRender);
    
    const sortControls = document.querySelector('.sort-controls');
    if(sortControls) {
        sortControls.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                const sortKey = e.target.dataset.sortKey;
                if (currentSort.key === sortKey) {
                    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.key = sortKey;
                    currentSort.order = 'asc';
                }
                applyFiltersAndRender();
            }
        });
    }

    function updateView() {
        if(outputTableDiv) outputTableDiv.style.display = currentView === 'card' ? 'block' : 'none';
        if(outputListDiv) outputListDiv.style.display = currentView === 'list' ? 'block' : 'none';
        if(viewAsCardButton) viewAsCardButton.classList.toggle('active', currentView === 'card');
        if(viewAsListButton) viewAsListButton.classList.toggle('active', currentView === 'list');
    }
    if(viewAsCardButton) viewAsCardButton.addEventListener('click', () => { currentView = 'card'; updateView(); });
    if(viewAsListButton) viewAsListButton.addEventListener('click', () => { currentView = 'list'; updateView(); });

    if(closeDialogButton) closeDialogButton.addEventListener('click', () => { editDialog.style.display = 'none'; });
    window.addEventListener('click', (event) => { if (event.target === editDialog) editDialog.style.display = 'none'; });
    
    // clearStorageButton and its handler were removed; clearing local sales cache
    // is handled by the Import UI flow when appropriate.

    // --- Admin: load stores into assign select and create user handler ---
    async function loadStoresForAssign() {
        const sel = document.getElementById('assignStoresSelect');
        if (!sel) return;
        try {
            const res = await fetch('/api/stores-list');
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '無法取得 stores');
            sel.innerHTML = '';
            data.stores.forEach(sk => {
                const opt = document.createElement('option');
                opt.value = sk;
                opt.textContent = sk;
                sel.appendChild(opt);
            });
        } catch (err) {
            console.error('載入 stores 失敗', err);
        }
    }

    const createUserBtn = document.getElementById('createUserBtn');
    if (createUserBtn) {
        createUserBtn.addEventListener('click', async () => {
            const username = document.getElementById('newUserUsername').value.trim();
            const password = document.getElementById('newUserPassword').value.trim();
            const displayName = document.getElementById('newUserDisplayName').value.trim();
            const sel = document.getElementById('assignStoresSelect');
            const statusSpan = document.getElementById('createUserStatus');
            const selected = Array.from(sel.selectedOptions).map(o => o.value);
            statusSpan.textContent = '建立中...';
            try {
                const res = await fetch('/api/users', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ username, password, displayName, stores: selected })
                });
                const data = await res.json();
                if (!data.success) throw new Error(data.message || '建立失敗');
                statusSpan.textContent = '建立成功';
                // clear inputs
                document.getElementById('newUserUsername').value = '';
                document.getElementById('newUserPassword').value = '';
                document.getElementById('newUserDisplayName').value = '';
                sel.selectedIndex = -1;
            } catch (err) {
                statusSpan.textContent = `錯誤: ${err.message}`;
                console.error('create user error', err);
            }
            setTimeout(() => { statusSpan.textContent = ''; }, 4000);
        });
    }

    // load stores for admin assign on start
    loadStoresForAssign();
    // load stores into create-user panel as well
    async function loadStoresForCreatePanel() {
        const sel = document.getElementById('cu_assignStores');
        if (!sel) return;
        try {
            const res = await fetch('/api/stores-list');
            const data = await res.json();
            if (!data.success) return;
            sel.innerHTML = '';
            data.stores.forEach(sk => {
                const opt = document.createElement('option');
                opt.value = sk;
                opt.textContent = sk;
                sel.appendChild(opt);
            });
        } catch (err) {
            console.error('載入 stores (create panel) 失敗', err);
        }
    }
    loadStoresForCreatePanel();

    // --- User management UI Handlers ---
    const userManagementDiv = document.getElementById('userManagement');
    const usersListContainer = document.getElementById('usersListContainer');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const showCreateUserPanelBtn = document.getElementById('showCreateUserPanelBtn');
    const createUserPanel = document.getElementById('createUserPanel');
    const cu_createBtn = document.getElementById('cu_createBtn');
    const cu_cancelBtn = document.getElementById('cu_cancelBtn');

    // Add a compact floating toggle for user management in the output-section (top-right)
    const userMgmtToggleBtn = document.createElement('button');
    userMgmtToggleBtn.textContent = '切換庫存/用戶';
    userMgmtToggleBtn.className = 'btn-outline-white';
    userMgmtToggleBtn.style.minWidth = '88px';
    userMgmtToggleBtn.style.padding = '6px 10px';
    userMgmtToggleBtn.style.margin = '0 6px';

    // place a floating area inside output-section so it doesn't push headers around
    const outputSection = document.querySelector('.output-section');
    let umFloatingArea = null;
    if (outputSection) {
        // ensure the section can be an absolute container
        try { outputSection.style.position = outputSection.style.position || 'relative'; } catch (e) {}
        umFloatingArea = document.createElement('div');
        umFloatingArea.style.position = 'absolute';
        umFloatingArea.style.top = '8px';
        umFloatingArea.style.right = '8px';
        umFloatingArea.style.display = 'flex';
        umFloatingArea.style.gap = '6px';
        umFloatingArea.style.alignItems = 'center';
        umFloatingArea.style.zIndex = '1200';
        umFloatingArea.appendChild(userMgmtToggleBtn);
        outputSection.appendChild(umFloatingArea);
    } else {
        const rightControls = document.querySelector('.right-side-controls');
        if (rightControls) rightControls.appendChild(userMgmtToggleBtn);
    }

    // style and move refresh/create user buttons into floating area (if present)
    const rBtn = document.getElementById('refreshUsersBtn');
    const cBtn = document.getElementById('showCreateUserPanelBtn');
    [rBtn, cBtn].forEach(b => {
        if (!b) return;
        b.classList.add('btn');
        b.style.margin = '0';
    });
    // Do not append refresh/create into the global floating area to avoid layout shifts.
    // They will be created or moved into the user-management header when the panel is shown.

    userMgmtToggleBtn.addEventListener('click', () => {
        const outputTable = document.getElementById('outputTable');
        const outputList = document.getElementById('outputList');
        const sortControlsEl = document.querySelector('.sort-controls');
        const rightControlsEl = document.querySelector('.right-side-controls');
        const mainH2 = document.querySelector('.output-section h2');
        const userMgmtHeaderArea = document.getElementById('usersListContainerWrapper');

        const showing = (userManagementDiv.style.display && userManagementDiv.style.display !== 'none');
        if (!showing) {
            // hide other UI chrome
            if (outputTable) outputTable.style.display = 'none';
            if (outputList) outputList.style.display = 'none';
            if (sortControlsEl) sortControlsEl.style.display = 'none';
            if (rightControlsEl) rightControlsEl.style.display = 'none';
            if (searchInput) searchInput.style.display = 'none';
            if (viewAsCardButton) viewAsCardButton.style.display = 'none';
            if (viewAsListButton) viewAsListButton.style.display = 'none';

            userManagementDiv.style.display = 'block';
            // Update H2 title
            if (mainH2) mainH2.textContent = '用戶管理';
            // create floating header controls inside userManagement (top-right)
            // place these controls in the parent userManagement container so they don't overlay the scrollable list
            if (userManagementDiv) {
                // move refresh/create into local floating area for this panel
                const localArea = document.createElement('div');
                localArea.style.position = 'absolute';
                localArea.style.top = '8px';
                localArea.style.right = '8px';
                localArea.style.display = 'flex';
                localArea.style.gap = '6px';
                localArea.id = 'um_local_area';
                // create or use existing refresh/create buttons
                let ref = document.getElementById('refreshUsersBtn');
                let create = document.getElementById('showCreateUserPanelBtn');
                if (!ref) {
                    ref = document.createElement('button');
                    ref.id = 'refreshUsersBtn';
                    ref.textContent = '重新整理用戶';
                    ref.className = 'btn-outline-white';
                    ref.addEventListener('click', fetchAndDisplayUsers);
                } else {
                    ref.classList.add('btn-outline-white');
                }
                if (!create) {
                    create = document.createElement('button');
                    create.id = 'showCreateUserPanelBtn';
                    create.textContent = '新增用戶';
                    create.className = 'btn-outline-white';
                    create.addEventListener('click', () => { createUserPanel.style.display = 'block'; });
                } else {
                    create.classList.add('btn-outline-white');
                }
                localArea.appendChild(ref);
                localArea.appendChild(create);
                // ensure userManagement container can contain absolute-positioned children
                try { userManagementDiv.style.position = userManagementDiv.style.position || 'relative'; } catch (e) {}
                userManagementDiv.appendChild(localArea);
                // add top padding to the scroll wrapper so the controls do not overlap the first user entry
                const wrapper = document.getElementById('usersListContainerWrapper');
                if (wrapper) wrapper.style.paddingTop = '44px';
            }
            fetchAndDisplayUsers();
        } else {
            // restore
            if (outputTable) outputTable.style.display = currentView === 'card' ? 'block' : 'none';
            if (outputList) outputList.style.display = currentView === 'list' ? 'block' : 'none';
            if (sortControlsEl) sortControlsEl.style.display = '';
            if (rightControlsEl) rightControlsEl.style.display = '';
            if (searchInput) searchInput.style.display = '';
            if (viewAsCardButton) viewAsCardButton.style.display = '';
            if (viewAsListButton) viewAsListButton.style.display = '';
            userManagementDiv.style.display = 'none';
            if (mainH2) mainH2.textContent = '機台管理';
            // remove local area if exists and restore wrapper padding
            const localArea = document.getElementById('um_local_area');
            if (localArea && localArea.parentNode) localArea.parentNode.removeChild(localArea);
            const wrapper = document.getElementById('usersListContainerWrapper');
            if (wrapper) wrapper.style.paddingTop = '';
        }
    });

    refreshUsersBtn && refreshUsersBtn.addEventListener('click', fetchAndDisplayUsers);
    showCreateUserPanelBtn && showCreateUserPanelBtn.addEventListener('click', () => { createUserPanel.style.display = 'block'; });
    cu_cancelBtn && cu_cancelBtn.addEventListener('click', () => { createUserPanel.style.display = 'none'; });

    async function fetchAndDisplayUsers() {
        usersListContainer.innerHTML = '<p>載入中...</p>';
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '無法取得用戶');
            renderUsersList(data.users || []);
        } catch (err) {
            usersListContainer.innerHTML = `<p style="color:var(--danger-color);">載入用戶失敗: ${err.message}</p>`;
            console.error('fetch users error', err);
        }
    }

    function renderUsersList(users) {
        if (!users || users.length === 0) {
            usersListContainer.innerHTML = '<p>尚無用戶</p>';
            return;
        }
        usersListContainer.innerHTML = '';
        users.forEach(u => {
            const div = document.createElement('div');
            div.style.borderBottom = '1px solid #333';
            div.style.padding = '8px';

            // Prepare display values: remove '-provisional_sales' suffix from shown stores
            const displayStores = (u.stores && Array.isArray(u.stores))
                ? u.stores.map(s => String(s).replace(/-provisional_sales/g, '')).join(', ')
                : '';

            // Normalize low inventory threshold field from different possible DB keys
            const lowThreshold = (u.low_inventory_threshold !== undefined && u.low_inventory_threshold !== null)
                ? u.low_inventory_threshold
                : (u.lowInventoryThreshold !== undefined && u.lowInventoryThreshold !== null)
                    ? u.lowInventoryThreshold
                    : '';

            div.innerHTML = `
                <div style="position:relative; padding:8px 44px 8px 0;">
                    <div style="">
                        <strong>${u.username}</strong> <span style="color:#999">(${u.display_name || ''})</span><br>
                        <small style="color:#777">id: ${u.id} • email: ${u.email || ''}</small><br>
                        <small style="color:#999">Stores: ${displayStores}</small><br>
                        <small style="color:#999">低庫存警戒值: ${lowThreshold !== '' ? lowThreshold : '未設定'}</small>
                    </div>
                    <button class="user-action-toggle" data-id="${u.id}" aria-expanded="false" title="操作" style="position:absolute; top:6px; right:6px; background:transparent; border:none; color:#fff; font-size:18px; cursor:pointer;">⋯</button>
                    <div class="user-action-menu" data-id="${u.id}" style="position:absolute; right:6px; top:34px; display:none; background:#222; border:1px solid #444; padding:6px; z-index:50; min-width:120px;">
                        <button class="menu-edit" data-id="${u.id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">編輯</button>
                        <button class="menu-reset" data-id="${u.id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">重設密碼</button>
                        <button class="menu-manage" data-id="${u.id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">管理機台</button>
                        <button class="menu-delete" data-id="${u.id}" style="display:block; width:100%; text-align:left; color:#fff; background:#b32;">刪除</button>
                    </div>
                </div>
            `;
            usersListContainer.appendChild(div);
        });

        // attach handlers for compact menus
        // toggle menu open/close
        document.querySelectorAll('.user-action-toggle').forEach(toggle => {
            toggle.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                const expanded = e.currentTarget.getAttribute('aria-expanded') === 'true';
                // close any floating menus
                document.querySelectorAll('.floating-user-action-menu').forEach(m => { m.remove(); });
                document.querySelectorAll('.user-action-toggle').forEach(t => { if (t !== e.currentTarget) t.setAttribute('aria-expanded', 'false'); });

                if (expanded) {
                    e.currentTarget.setAttribute('aria-expanded', 'false');
                    return;
                }

                // create floating menu in body so it can overflow container
                const rect = e.currentTarget.getBoundingClientRect();
                const menu = document.createElement('div');
                menu.className = 'floating-user-action-menu';
                menu.style.position = 'fixed';
                menu.style.left = (rect.right - 140) + 'px';
                menu.style.top = (rect.bottom + 6) + 'px';
                menu.style.background = '#000000ff';
                menu.style.border = '1px solid #444';
                menu.style.padding = '6px';
                menu.style.zIndex = 99999;
                menu.style.minWidth = '140px';
                menu.innerHTML = `
                    <button class="fmenu-edit" data-id="${id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">編輯</button>
                    <button class="fmenu-reset" data-id="${id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">重設密碼</button>
                    <button class="fmenu-manage" data-id="${id}" style="display:block; width:100%; text-align:left; margin-bottom:4px;">管理機台</button>
                    <button class="fmenu-delete" data-id="${id}" style="display:block; width:100%; text-align:left; color:#fff; background:#b32;">刪除</button>
                `;
                document.body.appendChild(menu);
                e.currentTarget.setAttribute('aria-expanded', 'true');

                // attach handlers for floating menu
                menu.querySelector('.fmenu-edit').addEventListener('click', (ev) => { openEditUserDialog(id); menu.remove(); e.currentTarget.setAttribute('aria-expanded', 'false'); });
                menu.querySelector('.fmenu-manage').addEventListener('click', (ev) => { openManageStoresDialog(id); menu.remove(); e.currentTarget.setAttribute('aria-expanded', 'false'); });
                menu.querySelector('.fmenu-reset').addEventListener('click', async (ev) => {
                    const np = prompt('輸入新密碼 (最少 8 個字元)，留空取消：');
                    if (!np) return;
                    if (np.length < 8) { alert('密碼長度至少 8 字元'); return; }
                    try {
                        const r = await fetch(`/api/users/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: np }) });
                        const j = await r.json();
                        if (!j.success) throw new Error(j.message || '重設失敗');
                        alert('密碼已更新');
                        fetchAndDisplayUsers();
                    } catch (err) { alert('重設失敗: ' + err.message); }
                    menu.remove(); e.currentTarget.setAttribute('aria-expanded', 'false');
                });
                menu.querySelector('.fmenu-delete').addEventListener('click', async (ev) => {
                    if (!confirm('確定要刪除此使用者與其相關紀錄？此操作無法還原。')) return;
                    try {
                        const r = await fetch(`/api/users/${id}`, { method: 'DELETE' });
                        const j = await r.json();
                        if (!j.success) throw new Error(j.message || '刪除失敗');
                        alert('刪除成功');
                        fetchAndDisplayUsers();
                    } catch (err) { alert('刪除失敗: ' + err.message); }
                    menu.remove(); e.currentTarget.setAttribute('aria-expanded', 'false');
                });

                // close floating menu when clicking elsewhere
                const closeFn = (ev) => {
                    if (ev.target.closest && ev.target.closest('.floating-user-action-menu')) return;
                    if (ev.target.closest && ev.target.closest('.user-action-toggle')) return;
                    menu.remove();
                    e.currentTarget.setAttribute('aria-expanded', 'false');
                    document.removeEventListener('click', closeFn);
                };
                setTimeout(() => document.addEventListener('click', closeFn), 0);
            });
        });

        // menu action handlers
        document.querySelectorAll('.menu-edit').forEach(btn => btn.addEventListener('click', (e) => { openEditUserDialog(e.currentTarget.dataset.id); }));
        document.querySelectorAll('.menu-manage').forEach(btn => btn.addEventListener('click', (e) => { openManageStoresDialog(e.currentTarget.dataset.id); }));
        document.querySelectorAll('.menu-reset').forEach(btn => btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            const np = prompt('輸入新密碼 (最少 8 個字元)，留空取消：');
            if (!np) return;
            if (np.length < 8) { alert('密碼長度至少 8 字元'); return; }
            try {
                const r = await fetch(`/api/users/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: np }) });
                const j = await r.json();
                if (!j.success) throw new Error(j.message || '重設失敗');
                alert('密碼已更新');
                fetchAndDisplayUsers();
            } catch (err) { alert('重設失敗: ' + err.message); }
        }));
        document.querySelectorAll('.menu-delete').forEach(btn => btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            if (!confirm('確定要刪除此使用者與其相關紀錄？此操作無法還原。')) return;
            try {
                const r = await fetch(`/api/users/${id}`, { method: 'DELETE' });
                const j = await r.json();
                if (!j.success) throw new Error(j.message || '刪除失敗');
                alert('刪除成功');
                fetchAndDisplayUsers();
            } catch (err) { alert('刪除失敗: ' + err.message); }
        }));

        // close menus when clicking elsewhere (add listener only once)
        if (!_userActionMenuListenerAdded) {
            _userActionMenuListenerAdded = true;
            document.addEventListener('click', (ev) => {
                if (!ev.target.closest || !!ev.target.closest('.user-action-menu') || !!ev.target.closest('.user-action-toggle')) return;
                document.querySelectorAll('.user-action-menu').forEach(m => m.style.display = 'none');
                document.querySelectorAll('.user-action-toggle').forEach(t => t.setAttribute('aria-expanded', 'false'));
            });
        }
    }

    // --- Edit / Manage stores dialogs (simple prompt-based for now) ---
    async function openEditUserDialog(userId) {
        try {
            const res = await fetch('/api/users');
            const data = await res.json();
            if (!data.success) throw new Error(data.message || '無法取得用戶資料');
            const user = (data.users || []).find(u => String(u.id) === String(userId));
            if (!user) throw new Error('找不到用戶');

            const newDisplay = prompt('顯示名稱', user.display_name || user.displayName || '');
            if (newDisplay === null) return;
            const newEmail = prompt('Email', user.email || '');
            if (newEmail === null) return;
            const newThreshold = prompt('低庫存警戒值 (空白代表 0)', user.low_inventory_threshold || user.lowInventoryThreshold || '');
            if (newThreshold === null) return;

            const payload = { displayName: newDisplay, email: newEmail, lowInventoryThreshold: newThreshold === '' ? 0 : parseInt(newThreshold, 10) || 0 };
            const r = await fetch(`/api/users/${userId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            const j = await r.json();
            if (!j.success) throw new Error(j.message || '更新失敗');
            alert('更新成功');
            fetchAndDisplayUsers();
        } catch (err) { alert('編輯失敗: ' + err.message); }
    }

    // Manage stores via modal multi-select
    let manageStoresTargetUserId = null;
    const manageStoresModal = document.getElementById('manageStoresModal');
    const manageStoresSelect = document.getElementById('manageStoresSelect');
    const manageStoresSaveBtn = document.getElementById('manageStoresSaveBtn');
    const manageStoresCancelBtn = document.getElementById('manageStoresCancelBtn');
    const manageStoresClose = manageStoresModal ? manageStoresModal.querySelector('.close') : null;

    async function openManageStoresDialog(userId) {
        manageStoresTargetUserId = userId;
        try {
            // load available stores
            const res = await fetch('/api/stores-list');
            const ds = await res.json();
            if (!ds.success) throw new Error(ds.message || '無法取得機台清單');

            // fetch user to get current assignments
            const ru = await fetch('/api/users');
            const udata = await ru.json();
            if (!udata.success) throw new Error(udata.message || '無法取得用戶');
            const user = (udata.users || []).find(u => String(u.id) === String(userId));
            if (!user) throw new Error('找不到用戶');

            // populate select
            manageStoresSelect.innerHTML = '';
            ds.stores.forEach(sk => {
                const opt = document.createElement('option');
                opt.value = sk;
                opt.textContent = sk;
                // preselect if in user's stores
                if (user.stores && user.stores.indexOf(sk) !== -1) opt.selected = true;
                manageStoresSelect.appendChild(opt);
            });

            // show modal
            manageStoresModal.style.display = 'block';
        } catch (err) {
            alert('取得機台清單或用戶資料失敗: ' + err.message);
        }
    }

    // modal handlers
    if (manageStoresClose) manageStoresClose.addEventListener('click', () => { manageStoresModal.style.display = 'none'; });
    if (manageStoresCancelBtn) manageStoresCancelBtn.addEventListener('click', () => { manageStoresModal.style.display = 'none'; });
    window.addEventListener('click', (e) => { if (e.target === manageStoresModal) manageStoresModal.style.display = 'none'; });

    if (manageStoresSaveBtn) manageStoresSaveBtn.addEventListener('click', async () => {
        if (!manageStoresTargetUserId) return;
        const selected = Array.from(manageStoresSelect.selectedOptions).map(o => o.value);
        try {
            const r = await fetch(`/api/users/${manageStoresTargetUserId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ stores: selected }) });
            const j = await r.json();
            if (!j.success) throw new Error(j.message || '更新失敗');
            alert('用戶機台已更新');
            manageStoresModal.style.display = 'none';
            fetchAndDisplayUsers();
        } catch (err) {
            alert('更新失敗: ' + err.message);
        }
    });

    // Create user panel handler (admin-only)
    cu_createBtn && cu_createBtn.addEventListener('click', async () => {
        const username = document.getElementById('cu_username').value.trim();
        const password = document.getElementById('cu_password').value.trim();
        const displayName = document.getElementById('cu_displayName').value.trim();
        const email = document.getElementById('cu_email').value.trim();
        const sel = document.getElementById('cu_assignStores');
        const selected = sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
        const statusSpan = document.getElementById('cu_status');
        if (!username || !password) { statusSpan.textContent = 'username & password 為必填'; return; }
        statusSpan.textContent = '建立中...';
        try {
            const res = await fetch('/api/users', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ username, password, displayName, stores: selected, email }) });
            const j = await res.json();
            if (!j.success) throw new Error(j.message || '建立失敗');
            statusSpan.textContent = '建立成功';
            document.getElementById('cu_username').value = '';
            document.getElementById('cu_password').value = '';
            document.getElementById('cu_displayName').value = '';
            document.getElementById('cu_email').value = '';
            sel.selectedIndex = -1;
            createUserPanel.style.display = 'none';
            fetchAndDisplayUsers();
        } catch (err) {
            statusSpan.textContent = '錯誤: ' + err.message;
            console.error('create user error', err);
        }
        setTimeout(() => { statusSpan.textContent = ''; }, 4000);
    });
    // saveDataButton removed from DOM; no legacy handler required.
    if(openChartWindowButton) {
        openChartWindowButton.addEventListener('click', () => {
        window.open('/presentation', '_blank');
        });
    }
    
    // --- Utility Functions ---
    function getStoreKey(item) {
        return (item && item.store && item.machineId) ? `${item.store}-${item.machineId}` : null;
    }

    function updateSortButtonsUI() {
        const sortButtons = document.querySelectorAll('.sort-controls button');
        if(sortButtons) {
            sortButtons.forEach(btn => {
                const icon = btn.querySelector('.sort-icon');
                if(!icon) return;
                if (btn.dataset.sortKey === currentSort.key) {
                    btn.classList.add('active');
                    icon.textContent = currentSort.order === 'asc' ? '▲' : '▼';
                } else {
                    btn.classList.remove('active');
                    icon.textContent = '';
                }
            });
        }
    }

    // --- Functions for features that still use localStorage (e.g., Sales Import) ---
    // These are kept for now and can be refactored in the future.
    function saveToLocalStorage(key, data) {
        try {
            const jsonData = JSON.stringify(data);
            localStorage.setItem(key, jsonData);
        } catch (e) {
            console.error(`保存到本地存儲失敗 (${key}):`, e);
        }
    }
    function loadFromLocalStorage(key) {
        try {
            const jsonData = localStorage.getItem(key);
            return jsonData ? JSON.parse(jsonData) : null;
        } catch (e) {
            console.error(`從本地存儲加載失敗 (${key}):`, e);
            return null;
        }
    }
    
    // ... (Placeholder for the full implementation of sales import, downloads, etc.)

    // --- Initial Load ---
    fetchAndDisplayData();
    loadUpdateLogs();
    updateView();

    function populateMonthSelector() {
        monthSelect.innerHTML = '<option value="">-- 請選擇 --</option>'; // Clear previous options
        const now = new Date();
        for (let i = 0; i < 12; i++) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const option = document.createElement('option');
            option.value = `${year}-${month}`;
            option.textContent = `${year}年 ${month}月`;
            monthSelect.appendChild(option);
        }
    }

    // --- Sales Import Logic ---
    // salesFileInput is handled via dropzone and has a single change listener
    // salesFileInput is handled by setupDropzone which wires its change event.

    // --- 庫存文件上傳事件監聽器 ---
    if (uploadInventoryFileButton) {
        uploadInventoryFileButton.addEventListener('click', () => inventoryFileInput.click());
    }

    if (inventoryFileInput) {
        inventoryFileInput.addEventListener('change', handleInventoryFileUpload);
    }

    function handleSalesFile(event) {
        // legacy handler left as noop to avoid duplicate processing.
        // New single processing path is wired via setupDropzone and includes debounce.
        const file = event && event.target && event.target.files ? event.target.files[0] : null;
        if (file) {
            // just clear the input to avoid accidental reuse
            try { event.target.value = ''; } catch (e) {}
        }
        return;
    }

    monthDialogCloseButton.onclick = () => monthSelectionDialog.style.display = 'none';
    cancelMonthButton.onclick = () => monthSelectionDialog.style.display = 'none';
    
    async function processSalesFile(file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
                
                const rawData = XLSX.utils.sheet_to_json(worksheet, {
                    raw: false,
                    defval: null
                });

                // 修正：欄位名稱必須與 Excel 中的完全一致，即使有拼寫錯誤
                const fullSalesData = rawData.map(row => ({
                    shopName: row['Shop name'],
                    product: row['Product'],
                    date: row['Trasaction Date'], // 改回匹配 Excel 的 'Trasaction Date'
                    amount: row['Total Transaction Amount'],
                    payType: row['Pay type']
                })).filter(item => item.shopName && item.date && item.amount);

        if (fullSalesData.length === 0) {
                    alert('無法從 Excel 檔案中解析出有效的銷售數據。請檢查欄位名稱是否正確 (例如: "Shop name", "Trasaction Date" 等) 且資料格式是否無誤。');
                    salesFileInput.value = '';
                return;
            }

                // 核心修改：直接上傳完整的交易紀錄
                await uploadTransactions(fullSalesData);

            } catch (error) {
                console.error('處理銷售文件時出錯:', error);
                alert('處理銷售文件失敗: ' + error.message);
            } finally {
                salesFileInput.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    }
    
    async function uploadTransactions(transactions) {
        alert('正在上傳銷售數據到伺服器...');
        try {
            const response = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(transactions)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            alert('銷售數據已成功上傳並永久保存！現在您可以進入「展示階段」查看。');
        } catch (error) {
            console.error('上傳交易數據失敗:', error);
            alert('上傳失敗: ' + error.message);
            throw error;
        }
    }

    // 移除已棄用的舊函數
    // function processSalesDataForMonth(...) {}
    // async function updateManualSales(...) {}

    // --- 庫存文件上傳功能 ---
    function handleInventoryFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (!file.name.endsWith('.json')) {
            alert('請選擇 JSON 格式的文件');
            inventoryFileInput.value = '';
            return;
        }
        
        uploadInventoryFile(file);
    }
    
    async function uploadInventoryFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // 顯示上傳進度
            uploadInventoryFileButton.disabled = true;
            uploadInventoryFileButton.textContent = '上傳中...';
            
            const response = await fetch('/upload-inventory-file', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert(`✅ 庫存文件上傳成功！\n\n處理項目數: ${result.items_processed}\n文件名: ${result.filename}\n\n數據已更新到數據庫，請刷新頁面查看最新數據。`);
                
                // 自動刷新數據
                await fetchAndDisplayData();
                
                // 刷新更新日誌
                await loadUpdateLogs();
            } else {
                throw new Error(result.message || '上傳失敗');
            }
            
        } catch (error) {
            console.error('上傳庫存文件失敗:', error);
            alert(`❌ 上傳失敗: ${error.message}`);
        } finally {
            uploadInventoryFileButton.disabled = false;
            uploadInventoryFileButton.textContent = '上傳庫存文件';
            inventoryFileInput.value = '';
        }
    }

    async function loadUpdateLogs() {
        const logList = document.getElementById('updateLogList');
        logList.innerHTML = '<p>正在加載紀錄...</p>';

        try {
            const response = await fetch('/api/update-logs');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const logs = await response.json();

            if (logs.length === 0) {
                logList.innerHTML = '<p>尚無更新紀錄。</p>';
            return;
        }
        
            logList.innerHTML = logs.map(log => {
                const ranAt = new Date(log.ranAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
                const typeText = log.scraperType === 'inventory' ? '庫存' : '銷售';
                const statusClass = log.status === 'success' ? 'log-success' : 'log-error';
                const statusIcon = log.status === 'success' ? '✅' : '❌';
                
                return `
                    <div class="log-entry ${statusClass}" style="margin-bottom: 8px; padding: 5px; border-left: 3px solid ${log.status === 'success' ? 'var(--success-color)' : 'var(--danger-color)'}; background-color: #333;">
                        <div><strong>${typeText}更新</strong> - <span style="font-size: 0.9em; color: var(--text-secondary);">${ranAt}</span></div>
                        <div>${statusIcon} ${log.details}</div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Failed to load update logs:', error);
            logList.innerHTML = '<p style="color: var(--danger-color);">加載更新紀錄失敗。</p>';
        }
    }

}); 