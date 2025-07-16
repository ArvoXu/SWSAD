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

    // --- Global State ---
    let currentView = 'card';
    let storeGroupsArray = [];
    let currentSort = { key: 'store', order: 'asc' };
    let currentEditingStore = null;
    let savedInventoryData = []; // Single source of truth for data from the server

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
    
    async function updateStoreData(storeKey, payload, actionName) {
        try {
            const response = await fetch(`/api/stores/${storeKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            alert(`${actionName}成功！`);
            await fetchAndDisplayData();
            if (actionName === '儲存') editDialog.style.display = 'none';
        } catch (error) {
            alert(`${actionName}失敗: ${error.message}`);
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

    function pollScraperStatus() {
        const statusCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/scraper-status');
                const result = await response.json();
                const updateButton = document.getElementById('autoUpdateButton');
                if (result.status === 'running') {
                    updateButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 爬蟲執行中...';
                } else {
                    clearInterval(statusCheckInterval);
                    if (result.status === 'success') {
                        updateButton.innerHTML = '<i class="fas fa-check-circle"></i> 更新成功';
                        alert('資料庫更新成功！正在獲取最新資料...');
                        await fetchAndDisplayData();
                    } else if (result.status === 'error') {
                        updateButton.innerHTML = '<i class="fas fa-times-circle"></i> 更新失敗';
                        alert(`爬蟲執行失敗: ${result.last_run_output}`);
                    }
                    setTimeout(() => {
                        if(updateButton) {
                            updateButton.innerHTML = '一鍵更新';
                            updateButton.disabled = false;
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
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 爬蟲執行中...';
                    pollScraperStatus();
                } else {
                    this.innerHTML = '一鍵更新';
                    this.disabled = false;
                    alert('錯誤：無法啟動爬蟲，可能已在執行中。');
                }
            }).catch(err => {
                this.innerHTML = '一鍵更新';
                this.disabled = false;
                alert(`啟動爬蟲失敗: ${err.message}`);
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
    
    if(clearStorageButton) {
        clearStorageButton.addEventListener('click', () => {
            if (confirm('此操作將清除本地暫存的「銷售導入」相關數據，但不會影響伺服器上的永久資料。是否繼續?')) {
                localStorage.removeItem('fullSalesData');
                localStorage.removeItem('salesData');
                localStorage.removeItem('selectedSalesMonth');
                alert('本地銷售數據暫存已清除。');
            }
        });
    }
    if(saveDataButton) saveDataButton.addEventListener('click', () => alert('此功能已過時。'));
    
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
    updateView();
});