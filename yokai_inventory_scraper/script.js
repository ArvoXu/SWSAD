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
    const toggleDebugButton = document.getElementById('toggleDebugButton');
    const debugInfoDiv = document.getElementById('debugInfo');
    const checkStorageButton = document.getElementById('checkStorageButton');
    const openChartWindowButton = document.getElementById('openChartWindowButton');
    const saveUpdateTimeButton = document.getElementById('saveUpdateTimeButton');
    const updateTimeInput = document.getElementById('updateTimeInput');
    
    // 一鍵更新按鈕
    const autoUpdateButton = document.getElementById('autoUpdateButton');

    // 搜尋相關元素
    const searchInput = document.getElementById('searchInput');

    // 視圖切換相關元素
    const viewAsCardButton = document.getElementById('viewAsCardButton');
    const viewAsListButton = document.getElementById('viewAsListButton');
    const outputListDiv = document.getElementById('outputList');
    let currentView = 'card'; // 'card' or 'list'
    
    // 排序相關
    let storeGroupsArray = []; // 用於存儲可排序的數據
    let currentSort = { key: 'store', order: 'asc' }; // 默認排序狀態

    // 銷售數據導入相關元素
    const importSalesButton = document.getElementById('importSalesButton');
    const salesFileInput = document.getElementById('salesFileInput');
    const monthSelectionDialog = document.getElementById('monthSelectionDialog');
    const monthSelect = document.getElementById('monthSelect');
    const confirmMonthButton = document.getElementById('confirmMonthButton');
    const cancelMonthButton = document.getElementById('cancelMonthButton');
    const monthDialogCloseButton = monthSelectionDialog.querySelector('.close');
    
    let parsedSalesData = []; // 用於存儲從Excel解析的原始銷售數據
    
    // 重定向控制台輸出到除錯區域
    if (debugInfoDiv) {
        const originalConsoleLog = console.log;
        const originalConsoleWarn = console.warn;
        const originalConsoleError = console.error;
        
        console.log = function() {
            // 原始控制台輸出
            originalConsoleLog.apply(console, arguments);
            
            // 添加到除錯區域
            const args = Array.from(arguments).map(arg => {
                if (typeof arg === 'object') {
                    return JSON.stringify(arg, null, 2);
                }
                return String(arg);
            });
            
            const message = args.join(' ');
            appendToDebugInfo('LOG: ' + message);
        };
        
        console.warn = function() {
            originalConsoleWarn.apply(console, arguments);
            const args = Array.from(arguments).map(arg => {
                if (typeof arg === 'object') {
                    return JSON.stringify(arg, null, 2);
                }
                return String(arg);
            });
            
            const message = args.join(' ');
            appendToDebugInfo('WARN: ' + message, 'orange');
        };
        
        console.error = function() {
            originalConsoleError.apply(console, arguments);
            const args = Array.from(arguments).map(arg => {
                if (typeof arg === 'object') {
                    return JSON.stringify(arg, null, 2);
                }
                return String(arg);
            });
            
            const message = args.join(' ');
            appendToDebugInfo('ERROR: ' + message, 'red');
        };
        
        function appendToDebugInfo(message, color = 'black') {
            const line = document.createElement('div');
            line.style.color = color;
            line.textContent = message;
            debugInfoDiv.appendChild(line);
            debugInfoDiv.scrollTop = debugInfoDiv.scrollHeight;
        }
    }
    
    // "一鍵更新" 按鈕事件
    if(autoUpdateButton) {
        autoUpdateButton.addEventListener('click', function() {
            // Immediately change button state
            this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 請求已發送...';
            this.disabled = true;

            fetch('/run-scraper', {
                method: 'POST'
            })
            .then(response => {
                if (response.status === 202) { // 202 Accepted: The request has been accepted for processing
                    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 爬蟲執行中...';
                    // Start polling for the status
                    pollScraperStatus();
                } else if (response.status === 409) { // 409 Conflict: Scraper is already running
                     alert('錯誤：爬蟲已經在執行中。請稍後再試。');
                     this.innerHTML = '一鍵更新';
                     this.disabled = false;
                } else {
                    return response.json().then(err => { throw new Error(err.message || '無法啟動爬蟲。') });
                }
            })
            .catch(error => {
                console.error('無法啟動爬蟲任務:', error);
                alert(`無法啟動爬蟲任務: ${error.message}`);
                this.innerHTML = '一鍵更新';
                this.disabled = false;
            });
        });
    }

    // New polling function
    function pollScraperStatus() {
        const statusCheckInterval = setInterval(async () => {
            try {
                const response = await fetch('/scraper-status');
                const result = await response.json();

                const updateButton = document.getElementById('autoUpdateButton');
                
                if (result.status === 'running') {
                    console.log('Scraper is running...');
                    updateButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 爬蟲執行中...';
                } else {
                    // Stop the interval once the status is no longer 'running'
                    clearInterval(statusCheckInterval);

                    if (result.status === 'success') {
                        console.log('Scraper finished successfully. Fetching data...');
                        updateButton.innerHTML = '<i class="fas fa-check-circle"></i> 更新成功';
                        alert('資料庫更新成功！正在獲取最新資料...');
                        await fetchAndDisplayData();
                    } else if (result.status === 'error') {
                        console.error('爬蟲執行失敗:', result.last_run_output);
                        updateButton.innerHTML = '<i class="fas fa-times-circle"></i> 更新失敗';
                        alert(`爬蟲執行失敗: ${result.last_run_output}`);
                    }
                    
                    // Reset the button after a short delay
                    setTimeout(() => {
                        updateButton.innerHTML = '一鍵更新';
                        updateButton.disabled = false;
                    }, 3000);
                }
            } catch (error) {
                console.error('輪詢狀態時出錯:', error);
                clearInterval(statusCheckInterval); // Stop polling on error
                const updateButton = document.getElementById('autoUpdateButton');
                updateButton.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 輪詢錯誤';
                alert('檢查爬蟲狀態時發生錯誤，請手動刷新頁面查看最新資料。');
                 setTimeout(() => {
                    updateButton.innerHTML = '一鍵更新';
                    updateButton.disabled = false;
                }, 3000);
            }
        }, 5000); // Poll every 5 seconds
    }
    
    // 切換除錯信息顯示
    toggleDebugButton.addEventListener('click', function() {
        if (debugInfoDiv.style.display === 'none') {
            debugInfoDiv.style.display = 'block';
            toggleDebugButton.textContent = '隱藏除錯信息';
        } else {
            debugInfoDiv.style.display = 'none';
            toggleDebugButton.textContent = '顯示除錯信息';
        }
    });
    
    // 視圖切換事件
    viewAsCardButton.addEventListener('click', () => {
        if (currentView !== 'card') {
            currentView = 'card';
            outputTableDiv.style.display = 'block';
            outputListDiv.style.display = 'none';
            viewAsCardButton.classList.add('active');
            viewAsListButton.classList.remove('active');
        }
    });

    viewAsListButton.addEventListener('click', () => {
        if (currentView !== 'list') {
            currentView = 'list';
            outputTableDiv.style.display = 'none';
            outputListDiv.style.display = 'block';
            viewAsCardButton.classList.remove('active');
            viewAsListButton.classList.add('active');
        }
    });
    
    // 新增：排序按鈕事件監聽
    document.querySelector('.sort-controls').addEventListener('click', (e) => {
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

    // 新增：搜尋事件監聽
    searchInput.addEventListener('input', () => {
        applyFiltersAndRender();
    });
    
    // 檢查本地存儲空間使用情況
    checkStorageButton.addEventListener('click', function() {
        const storageInfo = getLocalStorageInfo();
        
        // 在除錯區域顯示信息
        debugInfoDiv.innerHTML = '';
        debugInfoDiv.style.display = 'block';
        
        const usedKB = Math.round(storageInfo.usedSpace / 1024);
        const totalKB = Math.round(storageInfo.totalSpace / 1024);
        const percentUsed = Math.round((storageInfo.usedSpace / storageInfo.totalSpace) * 100);
        
        appendToDebugInfo(`---- 本地存儲空間使用情況 ----`, 'blue');
        appendToDebugInfo(`已使用: ${usedKB} KB / ${totalKB} KB (${percentUsed}%)`, 'black');
        appendToDebugInfo(`剩餘空間: ${totalKB - usedKB} KB`, 'black');
        appendToDebugInfo('', 'black');
        appendToDebugInfo('---- 分片詳情 ----', 'blue');
        
        // 顯示inventoryData分片
        const invChunks = localStorage.getItem('inventoryData_chunks');
        if (invChunks) {
            appendToDebugInfo(`庫存數據: ${invChunks} 個分片`, 'black');
        } else {
            appendToDebugInfo('庫存數據: 未使用分片儲存', 'black');
        }
        
        // 顯示storeNotesAndAddresses分片
        const notesChunks = localStorage.getItem('storeNotesAndAddresses_chunks');
        if (notesChunks) {
            appendToDebugInfo(`備註地址數據: ${notesChunks} 個分片`, 'black');
        } else {
            appendToDebugInfo('備註地址數據: 未使用分片儲存', 'black');
        }
        
        // 顯示數據詳情
        appendToDebugInfo('', 'black');
        appendToDebugInfo('---- 數據統計 ----', 'blue');
        
        if (savedInventoryData && savedInventoryData.length > 0) {
            // 計算店鋪數量
            const stores = new Set();
            savedInventoryData.forEach(item => {
                stores.add(`${item.store}-${item.machineId}`);
            });
            
            appendToDebugInfo(`已儲存 ${savedInventoryData.length} 項產品數據，涵蓋 ${stores.size} 家店鋪`, 'black');
        } else {
            appendToDebugInfo('未發現已儲存的庫存數據', 'orange');
        }
    });
    
    // 從本地存儲加載更新時間
    if (updateTimeInput) {
        updateTimeInput.value = localStorage.getItem('updateTime') || '';
    }

    // 保存更新時間
    if (saveUpdateTimeButton) {
        saveUpdateTimeButton.addEventListener('click', function() {
            const updateTime = updateTimeInput.value.trim();
            if (updateTime) {
                localStorage.setItem('updateTime', updateTime);
                alert('更新時間已保存！');
            } else {
                alert('請輸入更新時間。');
            }
        });
    }
    
    // 獲取本地存儲空間使用情況
    function getLocalStorageInfo() {
        let usedSpace = 0;
        const totalSpace = 5 * 1024 * 1024; // 5MB，這是大多數瀏覽器的上限
        
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                usedSpace += localStorage[key].length * 2; // UTF-16每個字符約2字節
            }
        }
        
        return {
            usedSpace: usedSpace,
            totalSpace: totalSpace
        };
    }
    
    // 添加信息到除錯區
    function appendToDebugInfo(message, color = 'black') {
        if (!debugInfoDiv) return;
        
        const line = document.createElement('div');
        line.style.color = color;
        line.textContent = message;
        debugInfoDiv.appendChild(line);
        debugInfoDiv.scrollTop = debugInfoDiv.scrollHeight;
    }
    
    let processedData = null;
    let currentEditingStore = null; // 當前編輯的店鋪ID
    
    // 從本地存儲加載備註和地址數據 (這些使用者自訂數據繼續保留在本地)
    let storeNotesAndAddresses = loadFromLocalStorage('storeNotesAndAddresses') || {};
    let hiddenStores = loadFromLocalStorage('hiddenStores') || {};
    
    // 全局庫存數據變量，將由 API 填充
    let savedInventoryData = [];
    
    // 處理數據 (此按鈕現在的功能是基於文本框的手動操作，與資料庫無關)
    processButton.addEventListener('click', function() {
        const rawData = rawDataTextarea.value.trim();
        if (!rawData) {
            alert('請先輸入庫存數據');
            return;
        }
        
        try {
            // 新增: 記錄處理時間
            const processTimestamp = new Date();

            // 解析新數據
            const newData = parseInventoryData(rawData, processTimestamp);
            
            // 檢查是否有現有數據需要合併
            if (savedInventoryData.length > 0) {
                processedData = mergeInventoryData(savedInventoryData, newData);
            } else {
                processedData = newData;
            }
            
            // 更新本地存儲 (手動模式下，暫存到LocalStorage)
            saveToLocalStorage('inventoryData_manual_override', processedData);
            savedInventoryData = processedData;
            
            // 顯示處理後數據
            displayResults(processedData);
            
            console.log("處理後數據:", processedData); // 用於除錯
            
            // 顯示成功消息
            alert(`數據處理成功！\n- 新增/更新了 ${newData.length} 項產品數據\n- 總共有 ${processedData.length} 項產品數據`);
        } catch (error) {
            console.error("解析錯誤:", error);
            alert("解析數據時發生錯誤: " + error.message);
        }
    });
    
    // 清除輸入區域數據
    clearButton.addEventListener('click', function() {
        rawDataTextarea.value = '';
        if (confirm('是否要清空顯示區域的數據？（已保存的數據不會被刪除）')) {
            outputTableDiv.innerHTML = '';
            processedData = null;
        }
    });
    
    // 清除所有本地存儲數據
    clearStorageButton.addEventListener('click', function() {
        if (confirm('確定要清除所有已保存的數據嗎？此操作不可恢復。這將清除本地的使用者備註、隱藏設定等，但不會刪除伺服器上的資料庫。')) {
            // 使用分片方式清除
            clearStorageChunks('inventoryData'); // 舊的，可能還存在
            clearStorageChunks('inventoryData_manual_override'); // 手動覆蓋的
            clearStorageChunks('storeNotesAndAddresses');
            clearStorageChunks('hiddenStores');
            
            // 移除舊式存儲（兼容性）
            localStorage.removeItem('inventoryData');
            localStorage.removeItem('inventoryData_manual_override');
            localStorage.removeItem('storeNotesAndAddresses');
            localStorage.removeItem('hiddenStores');
            
            savedInventoryData = [];
            storeNotesAndAddresses = {};
            hiddenStores = {};
            outputTableDiv.innerHTML = '';
            processedData = null;
            alert('所有數據已清除');
        }
    });
    
    // 保存數據到本地 (此按鈕的功能現已過時，可考慮移除或改造)
    saveDataButton.addEventListener('click', function() {
        alert('此功能已過時。數據現在從伺服器自動加載和更新。手動處理的數據會被下一次「一鍵更新」覆蓋。');
    });
    
    // 下載為真正的Excel (.xlsx)
    downloadExcelButton.addEventListener('click', function() {
        if (!processedData || processedData.length === 0) {
            if (savedInventoryData.length > 0) {
                processedData = savedInventoryData;
            } else {
                alert('請先處理數據');
                return;
            }
        }
        
        downloadXLSX(processedData);
    });
    
    // 下載為CSV
    downloadCSVButton.addEventListener('click', function() {
        if (!processedData || processedData.length === 0) {
            if (savedInventoryData.length > 0) {
                processedData = savedInventoryData;
            } else {
                alert('請先處理數據');
                return;
            }
        }
        
        downloadCSV(processedData);
    });
    
    // 關閉編輯對話框
    closeDialogButton.addEventListener('click', function() {
        editDialog.style.display = 'none';
    });
    
    // 點擊對話框外部區域關閉對話框
    window.addEventListener('click', function(event) {
        if (event.target === editDialog) {
            editDialog.style.display = 'none';
        }
    });
    
    // 保存備註按鈕事件
    saveNoteButton.addEventListener('click', function() {
        if (!currentEditingStore) return;
        
        const address = document.getElementById('storeAddress').value;
        const note = document.getElementById('storeNote').value;
        const sales = document.getElementById('storeSales').value;
        
        // 保存備註、地址和銷售額
        storeNotesAndAddresses[currentEditingStore] = {
            address: address,
            note: note,
            sales: sales ? parseInt(sales) : 0
        };
        
        // 保存到本地存儲
        saveToLocalStorage('storeNotesAndAddresses', storeNotesAndAddresses);
        
        // 更新顯示
        if (processedData && processedData.length > 0) {
            displayResults(processedData);
        } else if (savedInventoryData && savedInventoryData.length > 0) {
            displayResults(savedInventoryData);
        }
        
        // 關閉對話框
        editDialog.style.display = 'none';
    });
    
    // 全局化：切換隱藏狀態
    window.toggleHideStore = function(storeKey) {
        if (hiddenStores[storeKey]) {
            delete hiddenStores[storeKey];
        } else {
            hiddenStores[storeKey] = true;
        }
        
        saveToLocalStorage('hiddenStores', hiddenStores);
        applyFiltersAndRender(); // 重新渲染以應用樣式
    };
    
    // 進入展示階段按鈕事件
    openChartWindowButton.addEventListener('click', function() {
        if (!savedInventoryData || savedInventoryData.length === 0) {
            alert('沒有可視化的數據。請先「一鍵更新」獲取數據。');
            return;
        }

        const updateTime = document.getElementById('updateTimeInput').value;
        let url = 'presentation.html';

        if (updateTime) {
            url += '?updateTime=' + encodeURIComponent(updateTime);
        }

        // 數據已通過LocalStorage共享，直接打開新窗口即可
        const chartWindow = window.open(url, 'ChartWindow');
        if (!chartWindow) {
            alert('彈出窗口被阻止，請允許彈出窗口後重試。');
        }
    });
    
    // --- 新的數據獲取和頁面初始化流程 ---

    // 新增：從後端 API 獲取數據並渲染頁面的核心函數
    async function fetchAndDisplayData() {
        try {
            console.log("正在從伺服器獲取最新數據...");
            const response = await fetch('/get-data'); // 修正: 移除絕對路徑
            const result = await response.json();

            if (response.ok && result.success) {
                savedInventoryData = result.data; // 更新全局數據變量
                
                // 從數據中找到最新的更新時間並顯示
                if (savedInventoryData.length > 0) {
                    const latestProcessTime = savedInventoryData.reduce((latest, item) => {
                        return item.processTime > latest ? item.processTime : latest;
                    }, savedInventoryData[0].processTime);
                    updateTimeInput.value = new Date(latestProcessTime).toLocaleString();
                }

                displayResults(savedInventoryData);
                console.log('成功從伺服器獲取並顯示數據。', savedInventoryData);
            } else {
                console.error('獲取數據失敗:', result);
                outputTableDiv.innerHTML = `<p style="color: red;">無法從伺服器加載數據: ${result.message || '未知錯誤'}</p>`;
            }
        } catch (error) {
            console.error('獲取數據時發生網絡錯誤:', error);
            outputTableDiv.innerHTML = `<p style="color: red;">無法連接到伺服器。請確認 server.py 正在運行。</p>`;
        }
    }

    // 頁面載入時，自動從伺服器獲取初始數據
    fetchAndDisplayData();
    
    // 合併新舊庫存數據 (此函數在手動模式下仍然有用)
    function mergeInventoryData(oldData, newData) {
        // 創建一個映射，按店鋪-機台分組存儲舊數據
        const oldStoreData = {};
        oldData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            if (!oldStoreData[storeKey]) {
                oldStoreData[storeKey] = [];
            }
            oldStoreData[storeKey].push(item);
        });
        
        // 創建一個映射，按店鋪-機台分組存儲新數據
        const newStoreData = {};
        newData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            if (!newStoreData[storeKey]) {
                newStoreData[storeKey] = [];
            }
            newStoreData[storeKey].push(item);
        });
        
        // 合併結果
        const mergedData = [];
        
        // 首先，處理新數據中的所有店鋪-機台
        for (const storeKey in newStoreData) {
            // 新數據直接添加到結果中
            mergedData.push(...newStoreData[storeKey]);
            
            // 標記該店鋪-機台已處理
            delete oldStoreData[storeKey];
        }
        
        // 然後，處理舊數據中剩餘的店鋪-機台（這些在新數據中不存在）
        for (const storeKey in oldStoreData) {
            mergedData.push(...oldStoreData[storeKey]);
        }
        
        console.log(`合併後數據: 總計 ${mergedData.length} 項，來自 ${Object.keys(newStoreData).length} 個新店鋪-機台和 ${Object.keys(oldStoreData).length} 個舊店鋪-機台`);
        
        return mergedData;
    }
    
    // 保存到本地存儲 (使用分片存儲方式來避免容量限制)
    function saveToLocalStorage(key, data) {
        try {
            // 將數據轉換為JSON字符串
            const jsonData = JSON.stringify(data);
            
            // 計算需要多少分片來存儲數據
            // localStorage通常限制約為5MB
            const chunkSize = 500000; // 每個分片大約500KB
            const chunks = Math.ceil(jsonData.length / chunkSize);
            
            console.log(`數據總大小: ${jsonData.length} 字節，分為 ${chunks} 個分片`);
            
            // 先清除舊的分片
            clearStorageChunks(key);
            
            // 存儲分片數量
            localStorage.setItem(`${key}_chunks`, chunks.toString());
            
            // 存儲每個分片
            for (let i = 0; i < chunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, jsonData.length);
                const chunk = jsonData.substring(start, end);
                localStorage.setItem(`${key}_${i}`, chunk);
                console.log(`保存分片 ${i+1}/${chunks}, 大小: ${chunk.length} 字節`);
            }
            
            return true;
        } catch (e) {
            console.error('保存到本地存儲失敗:', e);
            alert('保存失敗: ' + e.message);
            return false;
        }
    }
    
    // 清除特定鍵的所有分片
    function clearStorageChunks(key) {
        try {
            // 獲取分片數量
            const chunksStr = localStorage.getItem(`${key}_chunks`);
            if (chunksStr) {
                const chunks = parseInt(chunksStr, 10);
                
                // 刪除所有分片
                for (let i = 0; i < chunks; i++) {
                    localStorage.removeItem(`${key}_${i}`);
                }
            }
            
            // 刪除分片計數
            localStorage.removeItem(`${key}_chunks`);
        } catch (e) {
            console.error('清除分片失敗:', e);
        }
    }
    
    // 從本地存儲加載 (支持分片數據)
    function loadFromLocalStorage(key) {
        try {
            // 檢查是否有分片數據
            const chunksStr = localStorage.getItem(`${key}_chunks`);
            
            if (chunksStr) {
                // 使用分片模式讀取
                const chunks = parseInt(chunksStr, 10);
                let jsonData = '';
                
                console.log(`從 ${chunks} 個分片讀取數據`);
                
                // 讀取所有分片並合併
                for (let i = 0; i < chunks; i++) {
                    const chunk = localStorage.getItem(`${key}_${i}`);
                    if (chunk) {
                        jsonData += chunk;
                        console.log(`讀取分片 ${i+1}/${chunks}, 當前總大小: ${jsonData.length} 字節`);
                    } else {
                        console.warn(`找不到分片 ${i+1}/${chunks}`);
                    }
                }
                
                // 解析JSON數據
                return jsonData ? JSON.parse(jsonData) : null;
            } else {
                // 嘗試使用舊式方法讀取（向後兼容）
                const data = localStorage.getItem(key);
                return data ? JSON.parse(data) : null;
            }
        } catch (e) {
            console.error('從本地存儲加載失敗:', e);
            return null;
        }
    }
    
    // 解析庫存數據
    function parseInventoryData(rawData, processTimestamp) {
        console.log("開始解析數據");
        
        const result = [];
        // 將\r\n和\r轉換為\n以確保跨平台兼容，並過濾空行
        const normalizedData = rawData.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalizedData.split('\n').map(l => l.trim()).filter(l => l);
        
        console.log("數據行數:", lines.length);
        
        // 為時間設定預設值
        let lastUpdated = formatDate(new Date()) + " 00:00:00";
        let lastCleaned = formatDate(new Date()) + " 00:00:00";
        
        // 遍歷所有行
        for (let i = 0; i < lines.length; ) {
            const line = lines[i];
            
            // 優先處理時間訊息行
            if (line.includes('上次補貨時間')) {
                try {
                    const replenishMatch = line.match(/上次補貨時間\s*:\s*(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2})/);
                    if (replenishMatch && replenishMatch[1]) lastUpdated = replenishMatch[1];
                    
                    const cleanMatch = line.match(/上次現場清潔時間\s*:\s*(\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2})/);
                    if (cleanMatch && cleanMatch[1]) lastCleaned = cleanMatch[1];
                    
                    console.log(`解析到時間: 補貨=${lastUpdated}, 清潔=${lastCleaned}`);
                } catch (e) {
                    console.error("解析時間信息失敗:", e);
                }
                i++; // 處理完畢，移至下一行
                continue;
            }
            
            // --- 使用「預讀」邏輯來識別產品條目 ---
            // 一個產品條目被定義為：一個非數字的店名，後跟一個以數字開頭的機台編號。
            const nextLine = (i + 1 < lines.length) ? lines[i+1] : '';
            if (!/^\d/.test(line) && /^\d/.test(nextLine)) {
                const currentStore = line;
                const currentMachineId = nextLine;
                const productName = (i + 2 < lines.length) ? lines[i+2] : '';
                const quantityStr = (i + 3 < lines.length) ? lines[i+3] : '';

                // 檢查後兩行是否看起來像產品名稱和有效的數量
                if (productName && /^\d+$/.test(quantityStr)) {
                    const quantity = parseInt(quantityStr, 10);
                    
                    console.log(`找到產品: ${currentStore} - ${currentMachineId} - ${productName}: ${quantity}`);

                        result.push({
                            store: currentStore,
                            machineId: currentMachineId,
                            productName: productName,
                            quantity: quantity,
                            lastUpdated: lastUpdated,
                        lastCleaned: lastCleaned,
                        processTime: processTimestamp
                    });
                    
                    i += 4; // 已消耗4行，直接跳到下一個可能的條目
                    continue;
                }
            }
            
            // 如果當前行不符合任何已知模式，則忽略它以避免解析錯誤
            console.warn(`忽略無法解析的行: "${line}"`);
            i++;
            }

        if (result.length === 0) {
            console.error("未能解析出任何數據");
            throw new Error("無法解析數據，請確認數據格式是否正確。");
        }
        
        // 檢查並合併同一次匯入中的重複項目，以最新一筆為準
        const uniqueItems = {};
        result.forEach(item => {
            const key = `${item.store}-${item.machineId}-${item.productName}`;
            uniqueItems[key] = item;
        });
        
        const finalResult = Object.values(uniqueItems);
        console.log(`解析完成，共 ${finalResult.length} 項唯一產品數據`);
        
        return finalResult;
    }
    
    // 顯示結果 - 現在作為數據準備和初始化的入口
    function displayResults(data) {
        if (!data || data.length === 0) {
            outputTableDiv.innerHTML = '<p>沒有數據可顯示</p>';
            outputListDiv.innerHTML = '';
            storeGroupsArray = [];
            return;
        }
        
        const cleanedData = data.filter(item => item.productName !== item.store);
        
        const storeGroups = {};
        cleanedData.forEach(item => {
            const storeKey = `${item.store}-${item.machineId}`;
            if (!storeGroups[storeKey]) {
                storeGroups[storeKey] = {
                    store: item.store,
                    machineId: item.machineId,
                    lastUpdated: item.lastUpdated,
                    lastCleaned: item.lastCleaned,
                    processTime: item.processTime ? new Date(item.processTime) : null,
                    products: []
                };
            }
            
            const existingProduct = storeGroups[storeKey].products.find(p => p.name === item.productName);
            if (!existingProduct) {
                storeGroups[storeKey].products.push({
                    name: item.productName,
                    quantity: item.quantity
                });
            }
        });
        
        // 轉換為可排序的數組並計算總量
        storeGroupsArray = Object.values(storeGroups).map(group => {
            const totalQuantity = group.products.reduce((sum, p) => sum + p.quantity, 0);
            return { ...group, totalQuantity };
        });
        
        // 初始排序和渲染
        sortAndRender();
    }
    
    // 新增：排序和渲染的函數
    function sortAndRender() {
        // 排序邏輯
        storeGroupsArray.sort((a, b) => {
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
        
        // 渲染視圖
        renderViews(storeGroupsArray);
        // 更新排序按鈕的UI
        updateSortButtonsUI();
        }

    // 新增: 整合篩選、排序與渲染
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