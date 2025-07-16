document.addEventListener('DOMContentLoaded', function() {
    // 檢查Chart.js是否已加載
    setTimeout(function() {
        if (typeof Chart === 'undefined') {
            console.error('Chart.js庫未正確加載！');
            alert('圖表功能可能無法正常工作，請確保網絡連接正常。');
        } else {
            console.log('Chart.js庫已成功加載，版本：', Chart.version);
        }
    }, 1000);

    // --- 新版元素獲取 ---
    const autoUpdateButton = document.getElementById('autoUpdateButton');
    const statusDiv = document.getElementById('status'); // 假設您在index.html中有一個<div id="status"></div>來顯示狀態
    const searchInput = document.getElementById('searchInput');
    const viewAsCardButton = document.getElementById('viewAsCardButton');
    const viewAsListButton = document.getElementById('viewAsListButton');
    const outputTableDiv = document.getElementById('outputTable');
    const outputListDiv = document.getElementById('outputList');
    
    // --- 狀態變量 ---
    let currentView = 'card';
    let storeGroupsArray = [];
    let currentSort = { key: 'store', order: 'asc' };
    let scraperPollingInterval; // 用於儲存輪詢的計時器

    // --- 初始化 ---
    // 頁面載入後立即獲取數據
    fetchData(); 

    // --- 事件監聽 ---

    // "一鍵更新" 按鈕事件
    if(autoUpdateButton) {
        autoUpdateButton.addEventListener('click', runScraper);
    }

    // 視圖切換事件
    viewAsCardButton.addEventListener('click', () => switchView('card'));
    viewAsListButton.addEventListener('click', () => switchView('list'));

    // 排序按鈕事件
    document.querySelector('.sort-controls').addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            handleSort(e.target.dataset.sortKey);
        }
    });

    // 搜尋事件
    searchInput.addEventListener('input', applyFiltersAndRender);

    // --- 核心功能函式 ---

    function runScraper() {
        statusDiv.innerHTML = '正在發送更新指令...';
        statusDiv.className = 'status-running';
        autoUpdateButton.disabled = true;

        fetch('/run-scraper', { method: 'POST' })
            .then(response => {
                if (response.status === 409) { // Conflict
                    return response.json().then(err => { throw new Error(err.message); });
                }
                return response.json();
            })
            .then(data => {
                if (data.success) {
                    statusDiv.innerHTML = '指令已收到，爬蟲在背景執行中... (請勿離開此頁面)';
                    if (scraperPollingInterval) clearInterval(scraperPollingInterval);
                    scraperPollingInterval = setInterval(pollScraperStatus, 5000);
                } else {
                    throw new Error(data.message);
                }
            })
            .catch(error => {
                console.error('Error starting scraper:', error);
                statusDiv.innerHTML = `錯誤: ${error.message}`;
                statusDiv.className = 'status-error';
                autoUpdateButton.disabled = false;
            });
    }

    function pollScraperStatus() {
        fetch('/scraper-status')
            .then(response => response.json())
            .then(data => {
                const startTime = data.last_run_start_time ? new Date(data.last_run_start_time).toLocaleString() : 'N/A';
                const endTime = data.last_run_end_time ? new Date(data.last_run_end_time).toLocaleString() : 'N/A';

                switch (data.status) {
                    case 'running':
                        statusDiv.innerHTML = `爬蟲執行中... (開始時間: ${startTime})`;
                        statusDiv.className = 'status-running';
                        break;
                    case 'success':
                        statusDiv.innerHTML = `更新成功！(完成時間: ${endTime}) 正在為您刷新數據...`;
                        statusDiv.className = 'status-success';
                        clearInterval(scraperPollingInterval);
                        autoUpdateButton.disabled = false;
                        // 自動刷新頁面數據
                        setTimeout(fetchData, 1000); // Delay a bit before fetching
                        break;
                    case 'error':
                        statusDiv.innerHTML = `更新失敗 (時間: ${endTime}). 錯誤: ${data.last_run_output}`;
                        statusDiv.className = 'status-error';
                        clearInterval(scraperPollingInterval);
                        autoUpdateButton.disabled = false;
                        break;
                    case 'idle':
                        statusDiv.innerHTML = '爬蟲處於閒置狀態。';
                        statusDiv.className = '';
                        clearInterval(scraperPollingInterval);
                        autoUpdateButton.disabled = false;
                        break;
                }
            })
            .catch(error => {
                console.error('Error polling status:', error);
                statusDiv.innerHTML = '無法獲取更新狀態，請檢查伺服器連接。';
                statusDiv.className = 'status-error';
                clearInterval(scraperPollingInterval);
                autoUpdateButton.disabled = false;
            });
    }

    async function fetchData() {
        const statusDiv = document.getElementById('status');
        statusDiv.innerHTML = '正在從伺服器獲取最新資料...';
        statusDiv.className = 'status-running';
        try {
            const response = await fetch('/get-data');
            if (!response.ok) {
                throw new Error(`伺服器錯誤: ${response.statusText}`);
            }
            const result = await response.json();
            if (result.success) {
                console.log(`成功獲取 ${result.data.length} 筆資料。`);
                // 將獲取的數據保存到全局變量
                savedInventoryData = result.data; 
                // 使用新數據重新渲染頁面
                applyFiltersAndRender(); 
                statusDiv.innerHTML = `資料載入成功！(上次更新: ${savedInventoryData.length > 0 ? new Date(savedInventoryData[0].process_time).toLocaleString() : 'N/A'})`;
                statusDiv.className = 'status-success';
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('獲取數據失敗:', error);
            statusDiv.innerHTML = `獲取數據失敗: ${error.message}`;
            statusDiv.className = 'status-error';
        }
    }

    function switchView(view) {
        if (currentView !== view) {
            currentView = view;
            outputTableDiv.style.display = view === 'card' ? 'block' : 'none';
            outputListDiv.style.display = view === 'list' ? 'block' : 'none';
            viewAsCardButton.classList.toggle('active', view === 'card');
            viewAsListButton.classList.toggle('active', view === 'list');
        }
    }
    
    function handleSort(sortKey) {
        if (currentSort.key === sortKey) {
            currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.key = sortKey;
            currentSort.order = 'asc';
        }
        applyFiltersAndRender();
    }
    
    // 將 applyFiltersAndRender 放在這裡，因為後續的函式會依賴它
    // 注意：您需要確保 savedInventoryData 和其他的全局變量在您原始的 script.js 中有定義
    let savedInventoryData = []; 

    function applyFiltersAndRender() {
        let dataToRender = [...storeGroupsArray];

        // 1. 應用搜尋篩選
        const searchTerm = searchInput.value.trim().toLowerCase();
        if (searchTerm) {
            dataToRender = dataToRender.filter(group => {
                const storeName = group.store.toLowerCase();
                const machineId = group.machineId.toLowerCase();
                return storeName.includes(searchTerm) || machineId.includes(searchTerm);
            });
        }

        // 2. 應用排序
        dataToRender.sort((a, b) => {
            const valA = a[currentSort.key];
            const valB = b[currentSort.key];

            let comparison = 0;
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            
            if (typeof valA === 'string') {
                comparison = valA.localeCompare(valB, 'zh-Hans-CN');
            } else if (typeof valA === 'number') {
                comparison = valA - valB;
            } else if (valA instanceof Date) {
                comparison = valA.getTime() - valB.getTime();
            }

            return currentSort.order === 'asc' ? comparison : -comparison;
        });

        // 3. 渲染結果
        renderViews(dataToRender);
        updateSortButtonsUI();
        }
        
    // 新增：更新排序按鈕UI的函數
    function updateSortButtonsUI() {
        document.querySelectorAll('.sort-controls button').forEach(btn => {
            const icon = btn.querySelector('.sort-icon');
            if (btn.dataset.sortKey === currentSort.key) {
                btn.classList.add('active');
                icon.textContent = currentSort.order === 'asc' ? '▲' : '▼';
            } else {
                btn.classList.remove('active');
                icon.textContent = '';
            }
        });
    }

    // 新增：渲染所有視圖的函數
    function renderViews(dataArray) {
        if (!dataArray || dataArray.length === 0) {
            outputTableDiv.innerHTML = '<p>沒有數據可顯示</p>';
            outputListDiv.innerHTML = '';
            return;
        }

        let maxProducts = 0;
        dataArray.forEach(group => {
            if (group.products.length > maxProducts) {
                maxProducts = group.products.length;
            }
        });
        
        // 創建HTML表格 - 為卡片和列表視圖準備
        let cardHtml = '<div class="multi-column-container">';
        let listHtml = '<div class="list-view-container">';
        
        dataArray.forEach(group => {
            const storeKey = `${group.store}-${group.machineId}`;
            const noteData = storeNotesAndAddresses[storeKey] || { address: '', note: '' };
            const isHidden = hiddenStores[storeKey];
            
            const replenishmentCleanInfo = `補貨: ${group.lastUpdated.split(' ')[0]} | 清潔: ${group.lastCleaned.split(' ')[0]}`;
            
            // 統一處理更新時間及其顏色
            let updateTimeHTML = '';
            let rawFormattedTime = 'N/A';
            if (group.processTime) {
                const processDate = group.processTime;
                const today = new Date();
                const processDateDay = new Date(processDate.getFullYear(), processDate.getMonth(), processDate.getDate());
                const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const diffTime = todayDay.getTime() - processDateDay.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let updateTimeColor;
                if (diffDays === 0) updateTimeColor = 'var(--success-color)';
                else if (diffDays === 1) updateTimeColor = 'var(--warning-color)';
                else updateTimeColor = 'var(--danger-color)';
                
                const d = processDate;
                const pad = (num) => String(num).padStart(2, '0');
                rawFormattedTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
                
                updateTimeHTML = `<span style="color: ${updateTimeColor};">更新時間: ${rawFormattedTime}</span>`;
            }
            
            // --- 渲染卡片視圖的HTML ---
            cardHtml += `
                <div class="store-container compact-container ${isHidden ? 'is-hidden' : ''}">
                    <table class="compact-table">
                        <tr class="store-header">
                            <td colspan="3">
                                ${group.store} ${group.machineId}
                                <button class="hide-button ${isHidden ? 'is-hidden' : ''}" onclick="toggleHideStore('${storeKey}')">${isHidden ? '取消隱藏' : '隱藏'}</button>
                                <button class="edit-button" onclick="editStoreNotes('${storeKey}')">編輯</button>
                                <button class="delete-button" onclick="deleteStoreData('${storeKey}')">刪除</button>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="3" class="compact-info">
                                ${replenishmentCleanInfo}
                                ${updateTimeHTML ? `<br>${updateTimeHTML}` : ''}
                            </td>
                        </tr>
            `;
            
            cardHtml += `
                <tr>
                    <td colspan="3">
                        <div class="info-box">
                            <div class="info-line">
                                ${noteData.address ? `地址: ${noteData.address}` : '&nbsp;'}
                            </div>
                            <div class="info-line">
                                ${noteData.note ? `備註: ${noteData.note}` : '&nbsp;'}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
            
            cardHtml += `
                    <tr>
                        <th class="col-num">#</th>
                        <th>產品名稱</th>
                        <th class="col-qty">數量</th>
                    </tr>
            `;
            
            group.products.forEach((product, index) => {
                cardHtml += `
                    <tr>
                        <td class="col-num">${index + 1}</td>
                        <td>${product.name}</td>
                        <td class="col-qty">${product.quantity}</td>
                    </tr>
                `;
            });
            
            const emptyRows = maxProducts - group.products.length;
            for (let i = 0; i < emptyRows; i++) {
                cardHtml += '<tr><td colspan="3">&nbsp;</td></tr>';
            }
            
            cardHtml += `
                <tr class="total-row">
                    <td colspan="2">總計</td>
                    <td class="col-qty">${group.totalQuantity}</td>
                </tr>
            `;
            
            cardHtml += '</table></div>';

            // --- 渲染列表視圖的HTML ---
            listHtml += `
                <div class="list-item ${isHidden ? 'is-hidden' : ''}" id="list-item-${storeKey}">
                    <div class="list-item-header" onclick="toggleListItem('${storeKey}')">
                        <div class="list-item-title">${group.store}</div>
                        <div class="list-item-info">${group.machineId}</div>
                        <div class="list-item-info">庫存總計: ${group.totalQuantity}</div>
                        <div class="list-item-info">${updateTimeHTML || `更新時間: ${rawFormattedTime}`}</div>
                        <div class="list-item-actions">
                            <button class="hide-button ${isHidden ? 'is-hidden' : ''}" onclick="event.stopPropagation(); toggleHideStore('${storeKey}')">${isHidden ? '取消隱藏' : '隱藏'}</button>
                            <button class="edit-button" onclick="event.stopPropagation(); editStoreNotes('${storeKey}')">編輯</button>
                            <button class="delete-button" onclick="event.stopPropagation(); deleteStoreData('${storeKey}')">刪除</button>
                            <span class="list-item-caret">▼</span>
                        </div>
                    </div>
                    <div class="list-item-content" id="list-content-${storeKey}" style="display: none;">
                        <div class="info-box" style="margin: 10px 0;">
                             <div class="info-line">
                                ${noteData.address ? `地址: ${noteData.address}` : '&nbsp;'}
                            </div>
                            <div class="info-line">
                                ${noteData.note ? `備註: ${noteData.note}` : '&nbsp;'}
                            </div>
                        </div>
                        <table class="compact-table">
                            <tr>
                                <th class="col-num">#</th>
                                <th>產品名稱</th>
                                <th class="col-qty">數量</th>
                            </tr>
            `;
            group.products.forEach((product, index) => {
                listHtml += `
                            <tr>
                                <td class="col-num">${index + 1}</td>
                                <td>${product.name}</td>
                                <td class="col-qty">${product.quantity}</td>
                            </tr>
                `;
            });
            listHtml += `
                        </table>
                    </div>
                </div>
            `;
        });

        cardHtml += '</div>';
        listHtml += '</div>';
        
        // 添加統計信息
        const totalStores = dataArray.length;
        const totalProducts = dataArray.reduce((sum, group) => sum + group.products.length, 0);
        const summaryHtml = `<p>共處理了 ${totalStores} 個店鋪的 ${totalProducts} 項產品數據</p>`;
        
        outputTableDiv.innerHTML = cardHtml + summaryHtml;
        outputListDiv.innerHTML = listHtml;
    }
        
    // 全局化編輯函數
        window.editStoreNotes = function(storeKey) {
            currentEditingStore = storeKey;
            
            // 獲取備註數據
            const noteData = storeNotesAndAddresses[storeKey] || { address: '', note: '', sales: 0 };
            
            // 填充表單
            document.getElementById('storeAddress').value = noteData.address;
            document.getElementById('storeNote').value = noteData.note;
            document.getElementById('storeSales').value = noteData.sales || '';
            
            // 顯示對話框
            editDialog.style.display = 'block';
        };
    
    // 新增: 展開/收合列表項的函數
    window.toggleListItem = function(storeKey) {
        const content = document.getElementById(`list-content-${storeKey}`);
        const caret = document.querySelector(`#list-item-${storeKey} .list-item-caret`);
        const isOpen = content.style.display === 'block';
        
        content.style.display = isOpen ? 'none' : 'block';
        caret.innerHTML = isOpen ? '▼' : '▲';
    };
    
    // 新增: 刪除特定機台數據的函數
    window.deleteStoreData = function(storeKey) {
        if (confirm(`確定要刪除機台 ${storeKey} 的所有庫存資料嗎？此操作不可恢復，但不會影響銷售訂單數據。`)) {
            // 從 savedInventoryData 中過濾掉該機台的數據
            savedInventoryData = savedInventoryData.filter(item => {
                const itemKey = `${item.store}-${item.machineId}`;
                return itemKey !== storeKey;
            });
            
            // 從 storeNotesAndAddresses 中刪除該機台的備註
            delete storeNotesAndAddresses[storeKey];

            // 更新本地存儲
            saveToLocalStorage('inventoryData', savedInventoryData);
            saveToLocalStorage('storeNotesAndAddresses', storeNotesAndAddresses);

            // 重新渲染顯示
            if (savedInventoryData.length > 0) {
                processedData = savedInventoryData;
                displayResults(savedInventoryData);
            } else {
                outputTableDiv.innerHTML = '<p>所有數據已被刪除。</p>';
                processedData = null;
            }

            alert(`機台 ${storeKey} 的庫存資料已成功刪除。`);
        }
    }
    
    // 下載為真正的Excel格式 (.xlsx)
    function downloadXLSX(data) {
        // 創建工作簿
        const wb = XLSX.utils.book_new();
        
        // 對數據進行預處理，移除重複的店鋪信息項
        const cleanedData = data.filter(item => {
            // 如果該項目的產品名稱與店鋪名相同，則跳過
            return item.productName !== item.store;
        });
        
        // 按店鋪分組，為每個店鋪創建一個工作表
        const storeGroups = {};
        cleanedData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            if (!storeGroups[storeKey]) {
                storeGroups[storeKey] = {
                    store: item.store,
                    machineId: item.machineId,
                    lastUpdated: item.lastUpdated,
                    lastCleaned: item.lastCleaned,
                    processTime: item.processTime,
                    products: []
                };
            }
            
            // 檢查是否已經添加過相同的產品
            const existingProduct = storeGroups[storeKey].products.find(p => p.name === item.productName);
            if (!existingProduct) {
                storeGroups[storeKey].products.push({
                    name: item.productName,
                    quantity: item.quantity
                });
            }
        });
        
        // 創建主工作表（所有數據）
        const wsData = [
            ['店鋪', '機器ID', '產品名稱', '數量', '上次補貨時間', '上次清潔時間', '地址', '備註']
        ];
        
        cleanedData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            const noteData = storeNotesAndAddresses[storeKey] || { address: '', note: '' };
            
            wsData.push([
                item.store,
                item.machineId,
                item.productName,
                item.quantity,
                item.lastUpdated,
                item.lastCleaned,
                noteData.address,
                noteData.note
            ]);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, '全部庫存');
        
        // 為每個店鋪創建單獨的工作表
        for (const storeKey in storeGroups) {
            const group = storeGroups[storeKey];
            const storeName = group.store.substring(0, 15); // Excel工作表名稱長度限制
            const noteData = storeNotesAndAddresses[storeKey] || { address: '', note: '' };
            
            // 計算商品數量總和
            let totalQuantity = 0;
            group.products.forEach(product => {
                totalQuantity += product.quantity;
            });
            
            // 機台容量上限
            const maxCapacity = 50;
            const usagePercentage = Math.min(Math.round((totalQuantity / maxCapacity) * 100), 100);
            
            // 店鋪工作表的數據
            const storeWsData = [
                ['店鋪: ' + group.store, '機器ID: ' + group.machineId],
                ['上次補貨時間: ' + group.lastUpdated, '上次清潔時間: ' + group.lastCleaned],
                ['地址: ' + (noteData.address || '無')],
                ['備註: ' + (noteData.note || '無')],
                ['機台使用情況:', `${totalQuantity}/${maxCapacity} (${usagePercentage}%)`],
                [], // 空行
                ['序號', '產品名稱', '數量']
            ];
            
            group.products.forEach((product, index) => {
                storeWsData.push([index + 1, product.name, product.quantity]);
            });
            
            // 添加總計行
            storeWsData.push(['', '總計', totalQuantity]);
            
            const storeWs = XLSX.utils.aoa_to_sheet(storeWsData);
            
            // 合併單元格美化顯示
            storeWs['!merges'] = [
                { s: {r: 0, c: 0}, e: {r: 0, c: 1} }, // 店鋪名稱
            ];
            
            // 調整列寬
            storeWs['!cols'] = [
                { wch: 6 },  // 序號列寬
                { wch: 40 }, // 產品名稱列寬
                { wch: 8 }   // 數量列寬
            ];
            
            // 添加工作表
            XLSX.utils.book_append_sheet(wb, storeWs, storeName);
        }
        
        // 寫入並保存文件
        const filename = `庫存報表_${formatDate(new Date())}.xlsx`;
        XLSX.writeFile(wb, filename);
    }
    
    // 下載為CSV
    function downloadCSV(data) {
        // 對數據進行預處理，移除重複的店鋪信息項
        const cleanedData = data.filter(item => {
            // 如果該項目的產品名稱與店鋪名相同，則跳過
            return item.productName !== item.store;
        });
        
        let csv = '店鋪,機器ID,產品名稱,數量,上次補貨時間,上次清潔時間,地址,備註\n';
        
        cleanedData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            const noteData = storeNotesAndAddresses[storeKey] || { address: '', note: '' };
            
            csv += `"${item.store}","${item.machineId}","${item.productName}","${item.quantity}","${item.lastUpdated}","${item.lastCleaned}","${noteData.address}","${noteData.note}"\n`;
        });
        
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.setAttribute('href', url);
        link.setAttribute('download', `庫存報表_${formatDate(new Date())}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    // 格式化日期為 YYYY-MM-DD
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // 創建甜甜圈圖表
    function createDonutChart(storeKey, products, chartMode = 'inline') {
        const chartElement = document.getElementById(`chart-${storeKey}`);
        if (!chartElement) {
            console.error(`找不到圖表元素: chart-${storeKey}`);
            return;
        }
        
        try {
            // 檢查是否已經有圖表實例，如果有則銷毀
            const existingChart = Chart.getChart(chartElement);
            if (existingChart) {
                existingChart.destroy();
            }
            
            // 計算總數量
            let totalQuantity = 0;
            products.forEach(product => {
                totalQuantity += product.quantity;
            });
            
            // 機台容量上限
            const maxCapacity = 50;
            const remainingCapacity = Math.max(0, maxCapacity - totalQuantity);
            
            // 準備數據
            const data = {
                labels: [...products.map(p => p.name), '空位'],
                datasets: [{
                    data: [...products.map(p => p.quantity), remainingCapacity],
                    backgroundColor: generateConsistentColors(products.map(p => p.name)).concat(['#e0e0e0']), // 最後一個顏色是灰色，代表空位
                    borderWidth: 1
                }]
            };
            
            // 創建圓餅圖
            new Chart(chartElement, {
                type: 'doughnut',
                data: data,
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: chartMode === 'card', // 只在卡片模式顯示圖例
                            position: 'bottom',
                            labels: {
                                boxWidth: 10,
                                font: {
                                    size: 10
                                }
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.raw || 0;
                                    const percentage = Math.round((value / maxCapacity) * 100);
                                    return `${label}: ${value} (${percentage}%)`;
                                }
                            }
                        }
                    },
                    cutout: '70%'
                }
            });
            
            console.log(`成功創建圖表: chart-${storeKey}`);
        } catch (error) {
            console.error(`創建圖表時出錯 chart-${storeKey}:`, error);
        }
    }
    
    // 為產品名稱生成一致的顏色（相同產品名稱總是相同顏色）
    // 全局產品顏色映射表，確保跨所有圖表的一致性
    

    // --- 銷售數據導入功能 ---

    // 1. 點擊"匯入銷售訂單"按鈕
    importSalesButton.addEventListener('click', () => {
        salesFileInput.click();
    });

    // 2. 選擇了Excel文件
    salesFileInput.addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            if (jsonData.length === 0) {
                alert('工作表為空或格式不正確。');
                return;
            }

            // 尋找列名
            const header = Object.keys(jsonData[0]);
            const findColumn = (possibleNames) => {
                for (const name of possibleNames) {
                    const found = header.find(h => h.toLowerCase().trim() === name);
                    if (found) return found;
                }
                return null;
            };

            const shopNameCol = findColumn(['shop name', 'shopname']);
            const productCol = findColumn(['product']);
            const dateCol = findColumn(['transaction date(local time)', 'trasaction date(local time)']);
            const amountCol = findColumn(['total transaction amount', 'total']);
            const payTypeCol = findColumn(['pay type']);

            if (!shopNameCol || !productCol || !dateCol || !amountCol || !payTypeCol) {
                alert(`無法找到所有必要的列。請確保Excel包含 'Shop name', 'Product', 'Transaction Date(Local Time)', 'Total Transaction Amount' 和 'Pay type' 這幾列。`);
                return;
            }

            parsedSalesData = jsonData.map(row => ({
                shopName: row[shopNameCol],
                product: row[productCol],
                date: row[dateCol],
                amount: row[amountCol],
                payType: row[payTypeCol] || '未知' // 提供默認值
            }));
            
            // 保存完整的銷售數據以供分析頁面使用
            saveToLocalStorage('fullSalesData', parsedSalesData);

            // 提取月份並顯示選擇對話框
            extractMonthsAndShowDialog(parsedSalesData);
        };

        reader.readAsArrayBuffer(file);
        // 重置文件輸入，以便可以重新選擇同一個文件
        event.target.value = '';
    });
    
    // 3. 提取月份並顯示對話框
    function extractMonthsAndShowDialog(salesData) {
        const months = new Set();
        salesData.forEach(row => {
            // Excel的日期可能會被解析為數字，需要轉換
            let date;
            if (typeof row.date === 'number') {
                // Excel's epoch starts on 1900-01-01, but there's a bug making it think 1900 is a leap year.
                // The formula (excelDate - 25569) * 86400 * 1000 correctly converts it to a JS timestamp.
                date = new Date((row.date - 25569) * 86400000);
            } else if (typeof row.date === 'string') {
                date = new Date(row.date);
            }

            if (date && !isNaN(date)) {
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                months.add(`${year}-${month}`);
            }
        });

        if (months.size === 0) {
            alert('在數據中未找到有效的日期。');
            return;
        }

        monthSelect.innerHTML = '';
        Array.from(months).sort().reverse().forEach(month => {
            const option = document.createElement('option');
            option.value = month;
            option.textContent = month;
            monthSelect.appendChild(option);
        });

        monthSelectionDialog.style.display = 'block';
    }
    
    // 4. 確認月份選擇
    confirmMonthButton.addEventListener('click', function() {
        const selectedMonth = monthSelect.value;
        if (!selectedMonth) {
            alert('請選擇一個月份。');
            return;
        }

        // 從本地存儲加載完整的銷售數據
        const fullSalesData = loadFromLocalStorage('fullSalesData') || [];
        if (fullSalesData.length === 0) {
            alert('未找到銷售數據，請先導入。');
            return;
        }
        
        // --- 以下邏輯僅為了計算選定月份的產品銷量，用於庫存視圖排名 ---
        const salesByShopAndProduct = {};
        const allSalesData = {}; 

        fullSalesData.forEach(row => {
            // 新增：過濾掉0元訂單
            const amount = parseFloat(row.amount) || 0;
            if (amount <= 0) {
                return; // 在 forEach 中，return 會跳過此次循環
            }

            let date;
            if (typeof row.date === 'number') {
                date = new Date((row.date - 25569) * 86400000);
            } else if (typeof row.date === 'string') {
                date = new Date(row.date);
            }

            if (date && !isNaN(date)) {
                const year = date.getFullYear();
                const month = (date.getMonth() + 1).toString().padStart(2, '0');
                
                const shopName = row.shopName;
                const productName = row.product;
                const transactionDateStr = date.toISOString().split('T')[0];
                
                // 處理所有訂單的銷售數據，以找到最新銷售日期
                if (!allSalesData[shopName]) {
                    allSalesData[shopName] = {};
                }
                if (!allSalesData[shopName][productName]) {
                    allSalesData[shopName][productName] = { count: 0, lastSoldDate: '' };
                }
                allSalesData[shopName][productName].count++;
                if (transactionDateStr > allSalesData[shopName][productName].lastSoldDate) {
                    allSalesData[shopName][productName].lastSoldDate = transactionDateStr;
                }
                
                // 僅為選定月份聚合銷售量，用於庫存視圖排名
                if (`${year}-${month}` === selectedMonth) {
                    if (!salesByShopAndProduct[shopName]) {
                        salesByShopAndProduct[shopName] = {};
                    }
                    if (!salesByShopAndProduct[shopName][productName]) {
                        salesByShopAndProduct[shopName][productName] = { count: 0 };
                    }
                    salesByShopAndProduct[shopName][productName].count++;
                }
            }
        });
        
        // 將最新的銷售日期從 allSalesData 合併到 salesByShopAndProduct
        for (const shopName in salesByShopAndProduct) {
            for (const productName in salesByShopAndProduct[shopName]) {
                if (allSalesData[shopName] && allSalesData[shopName][productName]) {
                    salesByShopAndProduct[shopName][productName].lastSoldDate = 
                        allSalesData[shopName][productName].lastSoldDate;
                }
            }
        }

        try {
            // 只保存用於庫存排名的月度銷量數據
            saveToLocalStorage('salesData', salesByShopAndProduct);
            saveToLocalStorage('selectedSalesMonth', selectedMonth);
            
            // 不再在此處保存趨勢數據，改由分析頁面動態生成
            // saveToLocalStorage('dailySalesTrend', dailySalesTrend); 
            
            alert(`已成功處理銷售數據！\n- ${selectedMonth} 的產品銷量將用於庫存排名。\n- 完整的銷售數據已保存，可用於銷售趨勢分析。`);
            monthSelectionDialog.style.display = 'none';
        } catch (error) {
            alert('保存銷售數據時出錯: ' + error.message);
            console.error(error);
        }
    });
    
    // 5. 關閉月份選擇對話框
    cancelMonthButton.addEventListener('click', () => {
        monthSelectionDialog.style.display = 'none';
    });
    monthDialogCloseButton.addEventListener('click', () => {
        monthSelectionDialog.style.display = 'none';
    });

    // --- END 銷售數據導入功能 ---

    // ... (可能存在的其他函數)
    
    function getStoreKey(item) {
        return `${item.store}-${item.machineId}`;
    }
}); 