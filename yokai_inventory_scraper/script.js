document.addEventListener('DOMContentLoaded', function () {
    // --- Element Selections ---
    const processButton = document.getElementById('processButton');
    const clearButton = document.getElementById('clearButton');
    const clearStorageButton = document.getElementById('clearStorageButton');
    const rawDataTextarea = document.getElementById('rawData');
    const outputTableDiv = document.getElementById('outputTable');
    const downloadExcelButton = document.getElementById('downloadExcelButton');
    const downloadCSVButton = document.getElementById('downloadCSVButton');
    const saveDataButton = document.getElementById('saveDataButton');
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
    const uploadInventoryFileButton = document.getElementById('uploadInventoryFileButton');
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

    // --- Warehouse File Upload Handling ---
    warehouseUploadBtn.addEventListener('click', () => {
        warehouseFileInput.click();
    });

    warehouseFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        // 更新檔案名稱顯示
        warehouseFileName.textContent = file.name;
        warehouseUploadStatus.textContent = '正在上傳...';
        warehouseUploadStatus.style.color = '#666';

        // 創建 FormData 對象
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/upload-warehouse-file', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                warehouseUploadStatus.textContent = '上傳成功！';
                warehouseUploadStatus.style.color = '#4CAF50';
                // 重新載入數據以顯示更新
                await fetchAndDisplayData();
            } else {
                throw new Error(result.message || '上傳失敗');
            }
        } catch (error) {
            warehouseUploadStatus.textContent = `上傳失敗: ${error.message}`;
            warehouseUploadStatus.style.color = '#f44336';
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
            updateTimeInput.value = new Date(latestTimestamp).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
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
    
    if (clearStorageButton) {
        clearStorageButton.addEventListener('click', () => {
            if (confirm('此操作將清除本地暫存的「銷售導入」相關數據，但不會影響伺服器上的永久資料。是否繼續?')) {
                // We only clear the sales-related data that is truly local now
                localStorage.removeItem('fullSalesData');
                localStorage.removeItem('salesData');
                localStorage.removeItem('selectedSalesMonth');
                alert('本地銷售數據暫存已清除。');
            }
        });
    }

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

    // Add a simple toggle button to show user management in the UI
    const userMgmtToggleBtn = document.createElement('button');
    userMgmtToggleBtn.textContent = '用戶管理';
    userMgmtToggleBtn.className = 'btn-info';
    userMgmtToggleBtn.style.marginLeft = '8px';
    const rightControls = document.querySelector('.right-side-controls');
    if (rightControls) rightControls.appendChild(userMgmtToggleBtn);

    userMgmtToggleBtn.addEventListener('click', () => {
        const outputSection = document.querySelector('.output-section');
        const outputTable = document.getElementById('outputTable');
        const outputList = document.getElementById('outputList');
        // toggle: when showing user management, hide the standard output table/list
        if (userManagementDiv.style.display === 'none' || !userManagementDiv.style.display) {
            // hide existing views
            if (outputTable) outputTable.style.display = 'none';
            if (outputList) outputList.style.display = 'none';
            userManagementDiv.style.display = 'block';
            fetchAndDisplayUsers();
        } else {
            userManagementDiv.style.display = 'none';
            // restore previous view
            if (outputTable) outputTable.style.display = currentView === 'card' ? 'block' : 'none';
            if (outputList) outputList.style.display = currentView === 'list' ? 'block' : 'none';
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
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <div style="flex:1">
                        <strong>${u.username}</strong> <span style="color:#999">(${u.display_name || ''})</span><br>
                        <small style="color:#777">id: ${u.id} • email: ${u.email || ''}</small><br>
                        <small style="color:#999">Stores: ${u.stores ? u.stores.join(', ') : ''}</small>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-primary btn-edit-user" data-id="${u.id}">編輯</button>
                        <button class="btn-clear btn-reset-password" data-id="${u.id}">重設密碼</button>
                        <button class="btn-info btn-manage-stores" data-id="${u.id}">管理機台</button>
                        <button class="btn-danger btn-delete-user" data-id="${u.id}">刪除</button>
                    </div>
                </div>
            `;
            usersListContainer.appendChild(div);
        });

        // attach handlers
        document.querySelectorAll('.btn-delete-user').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                if (!confirm('確定要刪除此使用者與其相關紀錄？此操作無法還原。')) return;
                try {
                    const r = await fetch(`/api/users/${id}`, { method: 'DELETE' });
                    const j = await r.json();
                    if (!j.success) throw new Error(j.message || '刪除失敗');
                    alert('刪除成功');
                    fetchAndDisplayUsers();
                } catch (err) {
                    alert('刪除失敗: ' + err.message);
                }
            });
        });

        document.querySelectorAll('.btn-edit-user').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                openEditUserDialog(id);
            });
        });

        document.querySelectorAll('.btn-manage-stores').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.currentTarget.dataset.id;
                    openManageStoresDialog(id);
                });
            });

        document.querySelectorAll('.btn-reset-password').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                const np = prompt('輸入新密碼 (最少 8 個字元)，留空取消：');
                if (!np) return;
                if (np.length < 8) { alert('密碼長度至少 8 字元'); return; }
                try {
                    const r = await fetch(`/api/users/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: np }) });
                    const j = await r.json();
                    if (!j.success) throw new Error(j.message || '重設失敗');
                    alert('密碼已更新');
                } catch (err) { alert('重設失敗: ' + err.message); }
            });
        });
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
    if(saveDataButton) saveDataButton.addEventListener('click', () => alert('此功能已過時。'));
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
    if (importSalesButton) {
        importSalesButton.addEventListener('click', () => salesFileInput.click());
    }

    if (salesFileInput) {
        salesFileInput.addEventListener('change', handleSalesFile);
    }

    // --- 庫存文件上傳事件監聽器 ---
    if (uploadInventoryFileButton) {
        uploadInventoryFileButton.addEventListener('click', () => inventoryFileInput.click());
    }

    if (inventoryFileInput) {
        inventoryFileInput.addEventListener('change', handleInventoryFileUpload);
    }

    function handleSalesFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        // 直接處理文件，不再需要月份選擇
        processSalesFile(file);
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