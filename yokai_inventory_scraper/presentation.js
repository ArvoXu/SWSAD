    // 操作教學展開/收合功能
    const tutorialHeader = document.querySelector('.tutorial-header');
    const tutorialContent = document.querySelector('.tutorial-content');
    const tutorialIcon = tutorialHeader.querySelector('.fa-chevron-down');

    if (tutorialHeader && tutorialContent) {
        // 預設收合教學內容
        tutorialContent.style.display = 'none';
        
        tutorialHeader.addEventListener('click', function() {
            const isExpanded = tutorialContent.style.display === 'block';
            tutorialContent.style.display = isExpanded ? 'none' : 'block';
            tutorialIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
            tutorialIcon.style.transition = 'transform 0.3s ease';
        });
    }

    window.chartGlassBg = 'rgba(255,255,255,0)'; // 預設全透明
    // 全局產品顏色映射表，確保跨所有圖表的一致性
    const globalProductColorMap = {};

    // 處理產生明細表的功能
        async function generateSalesDetail() {
            // 直接從 mainDatePickerInstance 獲取選擇的日期
            if (!mainDatePickerInstance.getStartDate() || !mainDatePickerInstance.getEndDate()) {
                alert('請選擇日期範圍');
                return;
            }

            // 使用選擇器的日期，確保格式正確
            const startDate = mainDatePickerInstance.getStartDate().format('YYYY-MM-DD');
            const endDate = mainDatePickerInstance.getEndDate().format('YYYY-MM-DD');

            console.log('Date range:', { startDate, endDate }); // 添加日誌輸出

            try {
                const response = await fetch('/api/generate-sales-detail', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        startDate: startDate,
                        endDate: endDate
                    })
                });

                const data = await response.json();
                
                if (data.success) {
                    // 下載生成的文件
                    window.location.href = `/download-sales-detail/${data.filename}`;
                } else {
                    alert(data.message || '生成明細表失敗');
                }
            } catch (error) {
                console.error('生成明細表時發生錯誤:', error);
                alert('生成明細表時發生錯誤');
            }
        }

        // 添加明細表按鈕的事件監聽器
        document.addEventListener('DOMContentLoaded', function() {
            const generateSalesDetailButton = document.getElementById('generateSalesDetailButton');
            if (generateSalesDetailButton) {
                generateSalesDetailButton.addEventListener('click', generateSalesDetail);
            }
        });
        
        // 新增：從URL獲取參數的函數
        function getDataFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const updateTime = params.get('updateTime');
            if (updateTime) {
                // 將從URL獲取的時間存儲到全局變量
                window.updateTime = decodeURIComponent(updateTime);
            }
        }

        // 輔助函數：從本地存儲加載數據（支持分片） - 這部分將被重構
        async function loadAllData() {
            // --- Logging Start ---
            console.log('[Debug] Starting loadAllData...');
            // --- Logging End ---

            // 首先嘗試從URL獲取更新時間
            getDataFromUrl();

            // 優先使用內嵌數據 (用於另存為HTML)
            if (typeof window.embeddedData !== 'undefined') {
                console.log('使用內嵌數據');
                window.inventoryData = window.embeddedData;
                window.storeNotesAndAddresses = window.embeddedNotes || {};
                window.fullSalesData = window.embeddedFullSalesData || null;
                // ... 其他嵌入數據 ...
                if (window.embeddedColorMap) {
                     Object.assign(globalProductColorMap, window.embeddedColorMap);
                }
                if (window.embeddedWarehouseData) {
                    window.warehouseData = window.embeddedWarehouseData;
                }
                return; // 返回 Promise.resolve() 的隱式結果
            }

            // --- API-driven data loading ---
            console.log('[Debug] Fetching data from server API...');
            try {
                // 並行獲取庫存、交易和倉庫數據
                const [inventoryRes, transactionsRes, warehousesRes] = await Promise.all([
                    fetch('/get-data'),
                    fetch('/api/transactions'),
                    fetch('/api/warehouses')
                ]);

                // --- Logging Start ---
                console.log('[Debug] API Response Status:', { inventory: inventoryRes.status, transactions: transactionsRes.status });
                if (!inventoryRes.ok) console.error('[Debug] Inventory response not OK:', await inventoryRes.text());
                if (!transactionsRes.ok) console.error('[Debug] Transactions response not OK:', await transactionsRes.text());
                // --- Logging End ---

                if (!inventoryRes.ok) throw new Error(`獲取庫存數據失敗: ${inventoryRes.statusText}`);
                const inventoryResult = await inventoryRes.json();
                
                // --- Logging Start ---
                console.log('[Debug] Parsed inventory data:', inventoryResult);
                // --- Logging End ---

                if (!inventoryResult.success) throw new Error(inventoryResult.message);
                
                if (!transactionsRes.ok) throw new Error(`獲取交易數據失敗: ${transactionsRes.statusText}`);
                window.fullSalesData = await transactionsRes.json();

                // --- NEW CENTRALIZED DATE PARSING ---
                if (window.fullSalesData) {
                    console.log('[Debug] loadAllData: Pre-parsing dates for fullSalesData...');
                    window.fullSalesData.forEach(d => {
                        if (d.date && typeof d.date === 'string') {
                            d.jsDate = new Date(d.date); // Simple and robust
                            if (isNaN(d.jsDate.getTime())) {
                                console.warn(`[Debug] Failed to parse date, setting to null. Original value:`, d.date);
                                d.jsDate = null;
                            }
                        } else {
                            d.jsDate = null;
                        }
                    });
                    console.log('[Debug] loadAllData: Date pre-parsing complete.');
                }
                // --- END ---

                // --- Logging Start ---
                console.log('[Debug] Parsed full sales data:', window.fullSalesData);
                // --- Logging End ---

                // 處理庫存數據
                const inventoryData = inventoryResult.data;
                window.inventoryData = inventoryData;

                // 從庫存數據中提取備註、地址和手動銷售額
                const notes = {};
                let latestProcessTime = 0;
                inventoryData.forEach(item => {
                    const storeKey = `${item.store}-${item.machineId}`;
                    if (!notes[storeKey]) {
                        notes[storeKey] = {
                            address: item.address,
                            note: item.note,
                            sales: item.manualSales || 0 // 恢復使用後端提供的銷售額
                        };
                    }
                    // 前端容錯：確保 processTime 總是被正確處理為 Date 物件
                    const processTimeValue = item.processTime ? new Date(item.processTime).getTime() : 0;
                    if (processTimeValue > latestProcessTime) {
                        latestProcessTime = processTimeValue;
                    }
                });
                window.storeNotesAndAddresses = notes;
                // --- Logging Start ---
                console.log('[Debug] Generated notes and addresses:', window.storeNotesAndAddresses);
                // --- Logging End ---

                if(latestProcessTime > 0) {
                     window.updateTime = new Date(latestProcessTime).toLocaleString('zh-TW');
                }
                 // 模擬舊版數據結構，以確保兼容性
                window.salesData = null; 
                window.selectedSalesMonth = null;
                
                console.log('[Debug] loadAllData finished successfully.');

            } catch (error) {
                console.error('[Debug] Error inside loadAllData:', error);
                // 可以在此處顯示錯誤訊息給用戶
                document.getElementById('chartContainer').innerHTML = `<p style="color: red;">加載數據失敗: ${error.message}</p>`;
                throw error; // 拋出錯誤以停止後續執行
            }
        }
        
        // 生成一致的顏色
        function generateConsistentColors(productNames) {
            const colors = [];
            
            // 預定義的顏色列表（明亮的顏色）
            const predefinedColors = [
                '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', 
                '#FF9F40', '#8AC926', '#FF595E', '#1982C4', '#6A4C93',
                '#F94144', '#F3722C', '#F8961E', '#F9C74F', '#90BE6D',
                '#43AA8B', '#577590', '#277DA1', '#EF476F', '#FFD166'
            ];
            
            // 使用全局映射而非局部變量
            let colorIndex = Object.keys(globalProductColorMap).length;
            
            productNames.forEach(name => {
                if (!globalProductColorMap[name]) {
                    globalProductColorMap[name] = predefinedColors[colorIndex % predefinedColors.length];
                    colorIndex++;
                }
                
                colors.push(globalProductColorMap[name]);
            });
            
            return colors;
        }
        
        // 創建圓餅圖
        function createDonutChart(storeKey, products) {
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
                                display: false
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
                            },
                            glassmorphismBackground: true
                        },
                        cutout: '70%'
                    }
                });
                
                console.log(`成功創建圖表: chart-${storeKey}`);
            } catch (error) {
                console.error(`創建圓餅圖失敗 ${storeKey}:`, error);
            }
        }
        
        // 顯示圓餅圖
        function displayCharts(data) {
            // --- Logging Start ---
            console.log('[Debug] displayCharts called with data:', data);
            // --- Logging End ---
            const chartContainer = document.getElementById('chartContainer');
            chartContainer.innerHTML = '';
            
            if (!data || data.length === 0) {
                chartContainer.innerHTML = '<p>沒有數據可顯示</p>';
                return;
            }

            // --- NEW: Calculate last 30 days sales data ---
            let last30DaysSalesData = {};
            let salesDateRangeText = '未加載銷售數據，無法計算排名。';

            if (window.fullSalesData && window.fullSalesData.length > 0) {
                const validDates = window.fullSalesData.map(d => d.jsDate).filter(Boolean);
                if (validDates.length > 0) {
                    // 1. Find the latest transaction date
                    const latestDate = new Date(Math.max(...validDates));
                    
                    // 2. Calculate the 30-day window
                    const endDate = new Date(latestDate);
                    const startDate = new Date(latestDate);
                    startDate.setDate(startDate.getDate() - 29); // 30 days inclusive
                    startDate.setHours(0, 0, 0, 0);
                    endDate.setHours(23, 59, 59, 999);

                    const formatDate = (date) => `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
                    salesDateRangeText = `顯示過去一個月 (${formatDate(startDate)} - ${formatDate(endDate)}) 的銷售數據。`;

                    // 3. Filter transactions within this window - 排除金額為0的交易
                    const recentSales = window.fullSalesData.filter(d => 
                        d.jsDate && d.jsDate >= startDate && d.jsDate <= endDate && parseFloat(d.amount) > 0
                    );

                    // 4. Aggregate the data
                    const aggregatedSales = {};
                    recentSales.forEach(sale => {
                        if (!sale.shopName || !sale.product) return;

                        const shopName = String(sale.shopName).trim();
                        const productName = String(sale.product).trim();

                        if (!aggregatedSales[shopName]) {
                            aggregatedSales[shopName] = {};
                        }
                        if (!aggregatedSales[shopName][productName]) {
                            aggregatedSales[shopName][productName] = { count: 0, lastSoldDate: '1970-01-01' };
                        }

                        aggregatedSales[shopName][productName].count++;
                        
                        // Add sales amount to the store's total
                        if (!aggregatedSales[shopName].totalSales) {
                            aggregatedSales[shopName].totalSales = 0;
                        }
                        aggregatedSales[shopName].totalSales += parseFloat(sale.amount) || 0;

                        const saleDateStr = sale.jsDate.toISOString().split('T')[0];
                        if (saleDateStr > aggregatedSales[shopName][productName].lastSoldDate) {
                            aggregatedSales[shopName][productName].lastSoldDate = saleDateStr;
                        }
                    });
                    last30DaysSalesData = aggregatedSales;
                }
            }
            
            // 對數據進行預處理，根據後端提供的 isHidden 標誌過濾數據
            const cleanedData = data.filter(item => !item.isHidden);
            
            // 按機台分組
            const storeGroups = {};
            cleanedData.forEach(item => {
                const storeKey = `${item.store}-${item.machineId}`;
                if (!storeGroups[storeKey]) {
                    storeGroups[storeKey] = {
                        store: item.store,
                        machineId: item.machineId,
                        lastUpdated: item.lastUpdated,
                        lastCleaned: item.lastCleaned,
                        products: [],
                        totalQuantity: 0 // 添加總數量欄位
                    };
                }
                
                // 檢查是否已經添加過相同的產品
                const existingProduct = storeGroups[storeKey].products.find(p => p.name === item.productName);
                if (!existingProduct) {
                    storeGroups[storeKey].products.push({
                        name: item.productName,
                        quantity: item.quantity
                    });
                    // 累計總數量
                    storeGroups[storeKey].totalQuantity += item.quantity;
                }
            });
            
            // 使用全局備註數據
            const storeNotesAndAddresses = window.storeNotesAndAddresses || {};
            
            // 將storeGroups轉換為數組以便排序
            let storeGroupsArray = Object.entries(storeGroups).map(([key, value]) => {
                // 獲取銷售額 - 改為使用動態計算的過去一個月銷售額
                const machineSalesTotal = last30DaysSalesData[value.store] ? last30DaysSalesData[value.store].totalSales : 0;
                // 新增：計算該機台過去一個月銷售份數
                let machineSalesCount = 0;
                if (last30DaysSalesData[value.store]) {
                    // 將所有產品的 count 相加
                    machineSalesCount = Object.values(last30DaysSalesData[value.store])
                        .filter(v => typeof v === 'object' && v.count !== undefined)
                        .reduce((sum, v) => sum + (v.count || 0), 0);
                }
                return {
                    key,
                    ...value,
                    salesAmount: machineSalesTotal,
                    salesCount: machineSalesCount
                };
            });
            
            // --- 新的排序和篩選邏輯 ---
            let fullStoreGroupsArray = [...storeGroupsArray];
            let currentInventorySort = { key: null, order: 'desc' }; // key: 'salesAmount', 'totalQuantity'

            function applyInventoryFiltersAndRender() {
                let dataToRender = [...fullStoreGroupsArray];
                const searchTerm = document.getElementById('inventorySearchInput').value.toLowerCase();

                // 1. 篩選
                if (searchTerm) {
                    dataToRender = dataToRender.filter(item => 
                        item.store.toLowerCase().includes(searchTerm) || 
                        item.machineId.toLowerCase().includes(searchTerm)
                    );
                }

                // 2. 排序
                if (currentInventorySort.key) {
                    dataToRender.sort((a, b) => {
                        const valA = a[currentInventorySort.key];
                        const valB = b[currentInventorySort.key];
                        const comparison = valA > valB ? -1 : (valA < valB ? 1 : 0);
                        return currentInventorySort.order === 'desc' ? comparison : -comparison;
                    });
                }
                
                renderStoreCards(dataToRender, storeNotesAndAddresses, last30DaysSalesData);
                updateSortButtonsState(currentInventorySort.key ? `sortBy${currentInventorySort.key}` : null);
            }
            
            // 添加排序和篩選事件監聽器
            document.getElementById('inventorySearchInput').addEventListener('input', applyInventoryFiltersAndRender);

            document.getElementById('sortBySales').addEventListener('click', function() {
                currentInventorySort = { key: 'salesAmount', order: 'desc' };
                applyInventoryFiltersAndRender();
                updateSortButtonsState('sortBySales');
            });
            
            document.getElementById('sortByInventoryDesc').addEventListener('click', function() {
                currentInventorySort = { key: 'totalQuantity', order: 'desc' };
                applyInventoryFiltersAndRender();
                updateSortButtonsState('sortByInventoryDesc');
            });
            
            document.getElementById('sortByInventoryAsc').addEventListener('click', function() {
                currentInventorySort = { key: 'totalQuantity', order: 'asc' };
                applyInventoryFiltersAndRender();
                updateSortButtonsState('sortByInventoryAsc');
            });
            
            // 初始渲染
            applyInventoryFiltersAndRender();
            
            // 更新摘要信息
            const summaryText = document.getElementById('summaryText');
            const updateTime = window.updateTime || '未設定';
            summaryText.innerHTML = `共有 ${storeGroupsArray.length} 個機台的庫存數據，總計 ${cleanedData.length} 項產品數據<br>更新時間: ${updateTime}`;

            const salesSummaryText = document.getElementById('salesSummaryText');
            salesSummaryText.textContent = salesDateRangeText;
        }
        
        // --- 新的銷售趨勢圖表邏輯 ---
        let mainSalesChartInstance = null;
        let mainDatePickerInstance = null;
        let compareDatePickerInstance = null;
        let isCompareMode = false;
        let activeSalesChart = 'daily';
        let activeTimeUnit = 'daily';
        let currentChartData = {};

        // 主線/對比線條件
        let mainLine = { store: '', product: '', start: null, end: null };
        let compareLines = []; // 最多4條對比線
        const MAX_COMPARE_LINES = 4;

        // 生成對比線區塊的HTML
        function generateCompareLineBlock(index) {
            return `
              <div class="compareline-block glass-card" id="compareLineBlock_${index}" style="display:none;">
                <div class="block-header">
                  <div class="block-title">對比線 ${index + 1} 設定</div>
                  <button class="remove-compare-btn" data-index="${index}">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
                <div class="block-fields param-row">
                  <div class="date-block">
                    <i class="fas fa-calendar-check"></i>
                    <label>日期</label>
                    <input id="compareDatePicker_${index}"/>
                  </div>
                  <div class="date-block">
                    <i class="fas fa-store"></i>
                    <label>分店</label>
                    <div id="compareStoreSelect_${index}" class="multi-select-input" tabindex="0" style="cursor:pointer;" placeholder="請選擇分店">請選擇分店</div>
                  </div>
                  <div class="date-block">
                    <i class="fas fa-cubes"></i>
                    <label>產品</label>
                    <div id="compareProductSelect_${index}" class="multi-select-input" tabindex="0" style="cursor:pointer;" placeholder="請選擇產品">請選擇產品</div>
                  </div>
                </div>
              </div>
            `;
        }

        function setupSalesTrendTab(fullSalesData) {
            if (!fullSalesData || fullSalesData.length === 0) {
                document.getElementById('sales-tab').innerHTML = '<p style="text-align: center;">沒有銷售數據可供分析。</p>';
                return;
            }
            // 1. 生成分店/產品選項
            const storeSet = new Set();
            const productSet = new Set();
            fullSalesData.forEach(d => {
                if (d.shopName) storeSet.add(d.shopName);
                if (d.product) productSet.add(d.product);
            });
            const storeList = Array.from(storeSet).sort();
            const productList = Array.from(productSet).sort();
            // 多選狀態（全域唯一）
            if (!window._mainMultiSelect) {
                window._mainMultiSelect = {
                    selectedStores: [],
                    selectedProducts: []
                };
            }
            const selectedStores = window._mainMultiSelect.selectedStores;
            const selectedProducts = window._mainMultiSelect.selectedProducts;

            // Modal 控制
            const modal = document.getElementById('multiSelectModal');
            const modalTitle = document.getElementById('multiSelectModalTitle');
            const modalList = document.getElementById('multiSelectModalList');
            const modalClose = document.getElementById('multiSelectModalClose');
            const modalConfirm = document.getElementById('multiSelectModalConfirm');
            let currentMultiType = null;
            let currentCompareIndex = null;

            // 主分店/產品輸入框
            const mainStoreInput = document.getElementById('mainStoreSelect');
            const mainProductInput = document.getElementById('mainProductSelect');

            // 打開多選 modal
            function openMultiSelect(type, compareIndex = null) {
                currentMultiType = type;
                currentCompareIndex = compareIndex;
                modal.style.display = 'flex';
                modalTitle.textContent = type === 'store' ? '選擇分店' : '選擇產品';

                // 獲取當前選中的項目
                let selected;
                if (compareIndex === null) {
                    // 主線
                    selected = type === 'store' ? 
                        window._mainMultiSelect.selectedStores : 
                        window._mainMultiSelect.selectedProducts;
                } else {
                    // 對比線
                    selected = type === 'store' ? 
                        compareLines[compareIndex].multiSelect.selectedStores : 
                        compareLines[compareIndex].multiSelect.selectedProducts;
                }

                // 生成卡片
                const list = type === 'store' ? storeList : productList;
                modalList.innerHTML = '';
                list.forEach(item => {
                    const card = document.createElement('div');
                    card.className = 'modal-card' + (selected.includes(item) ? ' selected' : '');
                    card.textContent = item;
                    card.addEventListener('click', () => {
                        if (selected.includes(item)) {
                            const idx = selected.indexOf(item);
                            selected.splice(idx, 1);
                            card.classList.remove('selected');
                        } else {
                            selected.push(item);
                            card.classList.add('selected');
                        }
                    });
                    modalList.appendChild(card);
                });
            }
            // 關閉 modal
            function closeModal() {
                modal.style.display = 'none';
            }
            modalClose.onclick = closeModal;
            modalConfirm.onclick = function() {
                // 強制同步 window._mainMultiSelect 的內容
                window._mainMultiSelect.selectedStores = [...window._mainMultiSelect.selectedStores];
                window._mainMultiSelect.selectedProducts = [...window._mainMultiSelect.selectedProducts];
                updateMultiSelectPlaceholder();
                closeModal();
                // 觸發資料聚合
                renderSalesChart(fullSalesData);
            };
            // 點擊外部關閉
            modal.addEventListener('mousedown', function(e) {
                if (e.target === modal) closeModal();
            });

            // 輸入框點擊
            mainStoreInput.onclick = () => openMultiSelect('store');
            mainProductInput.onclick = () => openMultiSelect('product');

            // 更新 placeholder
            function updateMultiSelectPlaceholder() {
                const selectedStores = window._mainMultiSelect.selectedStores;
                const selectedProducts = window._mainMultiSelect.selectedProducts;
                if (selectedStores.length === 0) {
                    mainStoreInput.textContent = '請選擇分店';
                } else if (selectedStores.length === 1) {
                    mainStoreInput.textContent = selectedStores[0];
                } else {
                    mainStoreInput.textContent = `${selectedStores.length}家分店`;
                }
                if (selectedProducts.length === 0) {
                    mainProductInput.textContent = '請選擇產品';
                } else if (selectedProducts.length === 1) {
                    mainProductInput.textContent = selectedProducts[0];
                } else {
                    mainProductInput.textContent = `${selectedProducts.length}項產品`;
                }
            }
            updateMultiSelectPlaceholder();

            // 2. 初始化日期選擇器
            const today = new Date();
            const defaultStart = new Date(today);
            defaultStart.setDate(today.getDate() - 29);
            mainDatePickerInstance = new Litepicker({
                element: document.getElementById('mainDatePicker'),
                singleMode: false,
                format: 'YYYY-MM-DD',
                setup: (picker) => {
                    picker.on('selected', (date1, date2) => {
                        mainLine.start = date1.dateInstance;
                        mainLine.end = new Date(date2.dateInstance);
                        mainLine.end.setHours(23,59,59,999);
                        renderSalesChart(fullSalesData);
                    });
                }
            });
            mainDatePickerInstance.setDateRange(defaultStart, today);
            mainLine.start = defaultStart;
            mainLine.end = today;

            // 3. 對比線多選設定
            compareLines = [];

            // 修改 modalConfirm 點擊事件處理
            modalConfirm.onclick = function() {
                if (currentCompareIndex === null) {
                    // 主線
                    window._mainMultiSelect.selectedStores = [...window._mainMultiSelect.selectedStores];
                    window._mainMultiSelect.selectedProducts = [...window._mainMultiSelect.selectedProducts];
                    updateMultiSelectPlaceholder();
                } else {
                    // 對比線
                    const currentLine = compareLines[currentCompareIndex];
                    if (currentLine) {
                        // 更新對應對比線的選擇
                        currentLine.multiSelect.selectedStores = [...currentLine.multiSelect.selectedStores];
                        currentLine.multiSelect.selectedProducts = [...currentLine.multiSelect.selectedProducts];
                        updateCompareMultiSelectPlaceholder(currentCompareIndex);
                    }
                }
                closeModal();
                
                // 在关闭modal后立即更新图表按钮状态
                const chartStatus = checkChartAvailability();
                document.querySelectorAll('.chart-switch-btn').forEach(button => {
                    if (button.dataset.chart !== 'daily') {
                        if (!chartStatus.available) {
                            button.classList.add('disabled');
                            button.title = chartStatus.reason;
                        } else {
                            button.classList.remove('disabled');
                            button.title = '';
                        }
                    }
                });
                
                // 如果当前视图被禁用，自动切换到daily视图
                if (!chartStatus.available && activeSalesChart !== 'daily') {
                    activeSalesChart = 'daily';
                    document.querySelectorAll('.chart-switch-btn').forEach(btn => {
                        btn.classList.remove('active');
                        if (btn.dataset.chart === 'daily') {
                            btn.classList.add('active');
                        }
                    });
                }
                
                renderSalesChart(fullSalesData);
            };

            // 更新：更新對比線多選顯示文字
            function updateCompareMultiSelectPlaceholder(index) {
                const compareLine = compareLines[index];
                if (!compareLine) return;

                const storeSelect = document.getElementById(`compareStoreSelect_${index}`);
                const productSelect = document.getElementById(`compareProductSelect_${index}`);
                const selectedStores = compareLine.multiSelect.selectedStores;
                const selectedProducts = compareLine.multiSelect.selectedProducts;

                if (storeSelect) {
                    if (selectedStores.length === 0) {
                        storeSelect.textContent = '請選擇分店';
                    } else if (selectedStores.length === 1) {
                        storeSelect.textContent = selectedStores[0];
                    } else {
                        storeSelect.textContent = `${selectedStores.length}家分店`;
                    }
                }

                if (productSelect) {
                    if (selectedProducts.length === 0) {
                        productSelect.textContent = '請選擇產品';
                    } else if (selectedProducts.length === 1) {
                        productSelect.textContent = selectedProducts[0];
                    } else {
                        productSelect.textContent = `${selectedProducts.length}項產品`;
                    }
                }
            }
            // 4. 新增對比按鈕
            const addCompareButton = document.getElementById('addCompareButton');
            const compareLineContainer = document.getElementById('compareLineContainer');
            isCompareMode = false;

            // 初始化對比線容器
            addCompareButton.addEventListener('click', function() {
                if (compareLines.length >= MAX_COMPARE_LINES) {
                    alert('最多只能添加4條對比線');
                    return;
                }

                // 檢查主線是否已設定
                if (!mainLine.start || !mainLine.end) {
                    // 如果主線沒有設定日期，則設定默認日期
                    const today = new Date();
                    const defaultStart = new Date(today);
                    defaultStart.setDate(today.getDate() - 29);
                    mainDatePickerInstance.setDateRange(defaultStart, today);
                    mainLine.start = defaultStart;
                    mainLine.end = today;
                }

                // 創建新的對比線
                const newIndex = compareLines.length;
                const newCompareLine = {
                    index: newIndex,
                    store: '',
                    product: '',
                    start: mainLine.start,
                    end: mainLine.end,
                    multiSelect: {
                        selectedStores: [],
                        selectedProducts: []
                    }
                };
                compareLines.push(newCompareLine);

                // 添加對比線區塊到容器
                compareLineContainer.insertAdjacentHTML('beforeend', generateCompareLineBlock(newIndex));
                const newBlock = document.getElementById(`compareLineBlock_${newIndex}`);
                newBlock.style.display = '';

                // 初始化新的日期選擇器
                const newDatePicker = new Litepicker({
                    element: document.getElementById(`compareDatePicker_${newIndex}`),
                    singleMode: false,
                    format: 'YYYY-MM-DD',
                    setup: (picker) => {
                        picker.on('selected', (date1, date2) => {
                            compareLines[newIndex].start = date1.dateInstance;
                            compareLines[newIndex].end = new Date(date2.dateInstance);
                            compareLines[newIndex].end.setHours(23,59,59,999);
                            renderSalesChart(fullSalesData);
                        });
                    }
                });
                newDatePicker.setDateRange(mainLine.start, mainLine.end);

                // 設置刪除按鈕事件
                const removeButton = newBlock.querySelector('.remove-compare-btn');
                removeButton.addEventListener('click', function() {
                    compareLines.splice(newIndex, 1);
                    newBlock.remove();
                    // 如果沒有對比線了，關閉對比模式
                    if (compareLines.length === 0) {
                        isCompareMode = false;
                    }
                    renderSalesChart(fullSalesData);
                });

                // 設置多選輸入框事件
                const storeSelect = document.getElementById(`compareStoreSelect_${newIndex}`);
                const productSelect = document.getElementById(`compareProductSelect_${newIndex}`);

                storeSelect.addEventListener('click', () => {
                    openMultiSelect('store', newIndex);
                });
                productSelect.addEventListener('click', () => {
                    openMultiSelect('product', newIndex);
                });

                isCompareMode = true;
                renderSalesChart(fullSalesData);
            });
            // 5. 預設主線條件
            mainLine.store = '';
            mainLine.product = '';
            // 6. 首次渲染
            renderSalesChart(fullSalesData);
            // 1. 時間單位切換器
            renderTimeUnitSwitcher();
        }

        // 1. 時間單位切換器
        function renderTimeUnitSwitcher() {
            const switcher = document.getElementById('timeUnitSwitcher');
            if (!switcher) return;
            switcher.innerHTML = `
                <button class="time-unit-btn${activeTimeUnit==='6h'?' active':''}" data-unit="6h"><i class="fas fa-clock"></i> <span>每6小時</span></button>
                <button class="time-unit-btn${activeTimeUnit==='daily'?' active':''}" data-unit="daily"><i class="fas fa-calendar-day"></i> <span>每日</span></button>
                <button class="time-unit-btn${activeTimeUnit==='2d'?' active':''}" data-unit="2d"><i class="fas fa-calendar-alt"></i> <span>每2日</span></button>
            `;
            switcher.querySelectorAll('.time-unit-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    activeTimeUnit = this.dataset.unit;
                    renderTimeUnitSwitcher();
                    renderSalesChart(window.fullSalesData);
                });
            });
        }

        // 2. 主線/對比線聚合（根據activeTimeUnit）
        function aggregateByUnit(data, unit, start, end) {
            if (!start || !end) return {labels:[], values:[], dateMap:[]};
            const labels = [], values = [], dateMap = [];
            let bucketStart = new Date(start);
            let idx = 1;
            let lastDateStr = '';
            while (bucketStart <= end) {
                let bucketEnd = new Date(bucketStart);
                let label = '';
                let nextBucketStart = new Date(bucketStart);
                switch(unit) {
                    case '6h': {
                        const hour = bucketStart.getHours();
                        let period = '';
                        if (hour >= 0 && hour < 6) period = '早';
                        else if (hour >= 6 && hour < 12) period = '早';
                        else if (hour >= 12 && hour < 18) period = '中';
                        else period = '晚';
                        const dateStr = `${bucketStart.getMonth()+1}/${bucketStart.getDate()}`;
                        if (hour === 0) {
                            label = dateStr;
                            lastDateStr = dateStr;
                        } else {
                            label = period;
                        }
                        bucketEnd.setHours(bucketEnd.getHours()+6,59,59,999);
                        nextBucketStart.setHours(nextBucketStart.getHours()+6,0,0,0);
                        break;
                    }
                    case '2d':
                        label = `${bucketStart.getMonth()+1}/${bucketStart.getDate()}`;
                        bucketEnd.setDate(bucketEnd.getDate()+1);
                        bucketEnd.setHours(23,59,59,999);
                        nextBucketStart.setDate(nextBucketStart.getDate()+2);
                        break;
                    default:
                        label = `${bucketStart.getMonth()+1}/${bucketStart.getDate()}`;
                        bucketEnd.setHours(23,59,59,999);
                        nextBucketStart.setDate(nextBucketStart.getDate()+1);
                }
                const sum = data.filter(d=>d.jsDate>=bucketStart&&d.jsDate<=bucketEnd&&parseFloat(d.amount)>0).reduce((s,d)=>s+(parseFloat(d.amount)||0),0);
                labels.push(label);
                values.push(sum);
                dateMap.push({start:new Date(bucketStart), end:new Date(bucketEnd)});
                bucketStart = nextBucketStart;
                idx++;
                if(bucketStart > end) break;
            }
            return {labels, values, dateMap};
        }

        // 3. renderSalesChart主線/對比線聚合與繪圖
        function renderSalesChart(fullSalesData) {
            // 每次渲染时更新按钮状态
            updateChartButtonsState();
            
            // 多選主線聚合
            const selectedStores = window._mainMultiSelect?.selectedStores || [];
            const selectedProducts = window._mainMultiSelect?.selectedProducts || [];
            // 將 mainLine.store/product 設為多選狀態（供 legend 用）
            mainLine.store = selectedStores.length === 1 ? selectedStores[0] : (selectedStores.length > 1 ? selectedStores : '');
            mainLine.product = selectedProducts.length === 1 ? selectedProducts[0] : (selectedProducts.length > 1 ? selectedProducts : '');
            const mainFiltered = fullSalesData.filter(d => {
                // 分店多選
                if (selectedStores.length > 0 && !selectedStores.includes(d.shopName)) return false;
                // 產品多選
                if (selectedProducts.length > 0 && !selectedProducts.includes(d.product)) return false;
                if (!d.jsDate) return false;
                if (parseFloat(d.amount) <= 0) return false; // 排除金額為0或負數的交易
                return d.jsDate >= mainLine.start && d.jsDate <= mainLine.end;
            });
            // 聚合主線數據
            const mainAgg = aggregateByUnit(mainFiltered, activeTimeUnit, mainLine.start, mainLine.end);
            
            // 對比線資料過濾
            let compareFilteredArray = [];
            let compareAggArray = [];
            
            if (isCompareMode) {
                compareFilteredArray = compareLines.map(compareLine => {
                    const selectedStores = compareLine.multiSelect.selectedStores;
                    const selectedProducts = compareLine.multiSelect.selectedProducts;

                    // 更新 compareLine 的顯示屬性
                    compareLine.store = selectedStores.length === 1 ? selectedStores[0] : 
                        (selectedStores.length > 1 ? selectedStores : '');
                    compareLine.product = selectedProducts.length === 1 ? selectedProducts[0] : 
                        (selectedProducts.length > 1 ? selectedProducts : '');

                    return fullSalesData.filter(d => {
                        if (selectedStores.length > 0 && !selectedStores.includes(d.shopName)) return false;
                        if (selectedProducts.length > 0 && !selectedProducts.includes(d.product)) return false;
                        if (!d.jsDate) return false;
                        if (parseFloat(d.amount) <= 0) return false;
                        return d.jsDate >= compareLine.start && d.jsDate <= compareLine.end;
                    });
                });

                compareAggArray = compareLines.map((compareLine, index) => {
                    if (compareLine.start && compareLine.end && compareFilteredArray[index]) {
                        return aggregateByUnit(compareFilteredArray[index], activeTimeUnit, compareLine.start, compareLine.end);
                    }
                    return null;
                });
            }

            // 計算最大數據長度
            const lengths = [mainAgg?.labels?.length || 0];
            compareAggArray.forEach(agg => {
                if (agg && agg.labels) {
                    lengths.push(agg.labels.length);
                }
            });
            const maxLen = Math.max(...lengths);
            
            // 確保有有效的標籤數據
            const labels = mainAgg?.labels || Array(maxLen).fill('');
            
            // KPI
            renderKPI(mainFiltered, isCompareMode ? compareFilteredArray[0] : null);
            // 1. 銷售趨勢（線圖）
            if(activeSalesChart==='daily') {
                const datasets = [
                    {
                        label: '主線',
                        data: [...mainAgg.values, ...Array(maxLen-mainAgg.values.length).fill(0)],
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        fill: false,
                        tension: 0.2,
                        borderWidth: 2,
                        pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                        pointRadius: 3,
                        pointHoverRadius: 5
                    }
                ];
                if (isCompareMode) {
                    // 對比線顏色列表
                    const compareColors = [
                        'rgba(170, 170, 170, 1)',   // 灰色
                        'rgba(255, 99, 132, 1)',    // 紅色
                        'rgba(75, 192, 192, 1)',    // 綠色
                        'rgba(153, 102, 255, 1)'    // 紫色
                    ];

                    // 添加每條對比線的數據
                    compareAggArray.forEach((compareAgg, index) => {
                        if (!compareAgg) return;

                        const color = compareColors[index % compareColors.length];
                        datasets.push({
                            label: `對比線 ${index + 1}`,
                            data: [...compareAgg.values, ...Array(maxLen - compareAgg.values.length).fill(0)],
                            borderColor: color,
                            backgroundColor: color.replace('1)', '0.2)'),
                            fill: false,
                            tension: 0.2,
                            borderDash: [5, 5],
                            borderWidth: 2,
                            pointBackgroundColor: color,
                            pointRadius: 3,
                            pointHoverRadius: 5
                        });
                    });
                }
                if (mainSalesChartInstance) mainSalesChartInstance.destroy();
                const ctx = document.getElementById('mainSalesChart').getContext('2d');
                mainSalesChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: true, position: 'top' },
                            tooltip: {
                                callbacks: {
                                    title: function(context) {
                                        const idx = context[0].dataIndex;
                                        const datasetIndex = context[0].datasetIndex;
                                        let tip = '';
                                        if(datasetIndex === 0 && mainAgg.dateMap[idx]) {
                                            tip += `主線: ${mainAgg.dateMap[idx].start.toLocaleDateString()}~${mainAgg.dateMap[idx].end.toLocaleDateString()}`;
                                        } else if(isCompareMode && compareAggArray[datasetIndex - 1]?.dateMap[idx]) {
                                            const compareAgg = compareAggArray[datasetIndex - 1];
                                            tip += `對比線 ${datasetIndex}: ${compareAgg.dateMap[idx].start.toLocaleDateString()}~${compareAgg.dateMap[idx].end.toLocaleDateString()}`;
                                        }
                                        return tip;
                                    }
                                }
                            },
                            glassmorphismBackground: true
                        },
                        scales: {
                            x: {
                                ticks: {
                                    color: function(context) {
                                        const index = context.index;
                                        const label = mainAgg.labels[index];
                                        if (!label) return '#666666';
                                        
                                        // 檢查是否為周末
                                        if (mainAgg.dateMap && mainAgg.dateMap[index]) {
                                            const date = mainAgg.dateMap[index].start;
                                            const dayOfWeek = date.getDay(); // 0=周日, 6=周六
                                            if (dayOfWeek === 0 || dayOfWeek === 6) {
                                                return '#ff4444'; // 紅色
                                            }
                                        }
                                        
                                        return '#666666'; // 預設顏色
                                    }
                                }
                            },
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) { return value.toLocaleString() + ' 元'; }
                                }
                            }
                        }
                    }
                });
                // 更新 legend
                const legendDiv = document.getElementById('lineLegend');
                function lineDesc(line, color, label) {
                    let desc = '';
                    if (line.start && line.end) desc += `${line.start.getFullYear()}/${line.start.getMonth()+1}/${line.start.getDate()} ~ ${line.end.getFullYear()}/${line.end.getMonth()+1}/${line.end.getDate()}`;
                    if (Array.isArray(line.store)) desc += `｜${line.store.length}家分店`;
                    else if (line.store) desc += `｜${line.store}`;
                    if (Array.isArray(line.product)) desc += `｜${line.product.length}項產品`;
                    else if (line.product) desc += `｜${line.product}`;
                    return `<span class=\"legend-dot\" style=\"background:${color}\"></span>${label}：${desc}`;
                }
                // 更新圖例
                const compareColors = [
                    'rgba(170, 170, 170, 1)',   // 灰色
                    'rgba(255, 99, 132, 1)',    // 紅色
                    'rgba(75, 192, 192, 1)',    // 綠色
                    'rgba(153, 102, 255, 1)'    // 紫色
                ];
                
                let legendHtml = lineDesc(mainLine, 'rgba(54, 162, 235, 1)', '主線');
                if (isCompareMode) {
                    compareLines.forEach((line, index) => {
                        legendHtml += '　' + lineDesc(line, compareColors[index % compareColors.length], `對比線 ${index + 1}`);
                    });
                }
                legendDiv.innerHTML = legendHtml;
            } else {
                // 2. 其他圖表
                renderOtherCharts(fullSalesData, mainFiltered, compareFilteredArray);
            }
        }

        // 4. 其他圖表聚合
        // 检查图表是否可用的全局函数
        function checkChartAvailability() {
            const mainMultiSelect = window._mainMultiSelect || { selectedStores: [], selectedProducts: [] };
            
            // 1. 检查主线多选状态
            if (mainMultiSelect.selectedStores.length > 1 || 
                mainMultiSelect.selectedProducts.length > 1) {
                return {
                    available: false,
                    reason: '已選擇多個分店或產品，請只選擇一個分店和一個產品以使用此圖表'
                };
            }

            // 2. 如果有比较线，检查选择状态
            if (compareLines && compareLines.length >= 1) {
                // 只在有实际选择时才禁用（空选择表示选择所有）
                const hasSpecificSelection = (selectedStores, selectedProducts) => 
                    selectedStores.length === 1 || selectedProducts.length === 1;

                if (hasSpecificSelection(mainMultiSelect.selectedStores, mainMultiSelect.selectedProducts)) {
                    return {
                        available: false,
                        reason: '因有對比線且已選擇特定分店或產品，此圖表暫不可用。清除分店和產品選擇即可查看所有分店數據。'
                    };
                }

                for (const line of compareLines) {
                    if (line.multiSelect && hasSpecificSelection(line.multiSelect.selectedStores, line.multiSelect.selectedProducts)) {
                        return {
                            available: false,
                            reason: '因有對比線且已選擇特定分店或產品，此圖表暫不可用。清除分店和產品選擇即可查看所有分店數據。'
                        };
                    }
                }
            }

            return { available: true, reason: '' };
        }

        // 更新图表按钮状态的全局函数
        function updateChartButtonsState() {
            const chartStatus = checkChartAvailability();
            
            // 更新所有按钮状态
            document.querySelectorAll('.chart-switch-btn').forEach(button => {
                if (button.dataset.chart !== 'daily') {
                    if (!chartStatus.available) {
                        button.classList.add('disabled');
                        button.title = chartStatus.reason;
                    } else {
                        button.classList.remove('disabled');
                        button.title = '';
                    }
                }
            });

            // 如果当前视图被禁用，自动切换到daily视图
            if (!chartStatus.available && activeSalesChart !== 'daily') {
                activeSalesChart = 'daily';
                document.querySelectorAll('.chart-switch-btn').forEach(btn => {
                    btn.classList.remove('active');
                    if (btn.dataset.chart === 'daily') {
                        btn.classList.add('active');
                    }
                });
                return true; // 表示发生了视图切换
            }
            return false;
        }

        function renderOtherCharts(fullSalesData, mainFiltered, compareFiltered) {
            // 检查是否需要禁用其他图表
            if (updateChartButtonsState()) {
                return; // 如果发生了视图切换，终止继续渲染
            }

            // 分店銷售額
            function aggStore(data) {
                const map = {};
                data.forEach(d=>{if(d.shopName && parseFloat(d.amount) > 0) map[d.shopName]=(map[d.shopName]||0)+(parseFloat(d.amount)||0);});
                return map;
            }
            // 產品佔比
            function aggProduct(data) {
                const map = {};
                data.forEach(d=>{if(d.product && parseFloat(d.amount) > 0) map[d.product]=(map[d.product]||0)+(parseFloat(d.amount)||0);});
                return map;
            }
            // 支付方式
            function aggPay(data) {
                const map = {};
                data.forEach(d=>{if(d.payType && parseFloat(d.amount) > 0) map[d.payType]=(map[d.payType]||0)+1;});
                return map;
            }
            // 切換圖表前先 destroy
            if (mainSalesChartInstance) mainSalesChartInstance.destroy();
            if(activeSalesChart==='store') {
                const main = aggStore(mainFiltered);
                const compare = isCompareMode ? aggStore(compareFiltered) : null;
                renderStoreSalesChart(main, compare);
            } else if(activeSalesChart==='product') {
                const main = aggProduct(mainFiltered);
                const compare = isCompareMode ? aggProduct(compareFiltered) : null;
                renderProductSalesChart(main, compare);
            } else if(activeSalesChart==='payment') {
                const main = aggPay(mainFiltered);
                const compare = isCompareMode ? aggPay(compareFiltered) : null;
                renderPaymentTypeChart(main, compare);
            }
        }

        // 5. 圖表切換按鈕事件
        // 在setupSalesTrendTab內部加：
        document.querySelectorAll('.chart-switch-btn').forEach(button => {
            button.addEventListener('click', () => {
                // 如果按钮被禁用，显示提示信息
                if (button.classList.contains('disabled')) {
                    const tooltip = document.createElement('div');
                    tooltip.className = 'chart-switch-tooltip';
                    tooltip.textContent = button.title || '此圖表目前不可用';
                    tooltip.style.position = 'absolute';
                    tooltip.style.zIndex = '1000';
                    tooltip.style.backgroundColor = 'rgba(51, 51, 51, 0.95)';
                    tooltip.style.color = 'white';
                    tooltip.style.padding = '8px 12px';
                    tooltip.style.borderRadius = '6px';
                    tooltip.style.fontSize = '14px';
                    tooltip.style.maxWidth = '300px';
                    tooltip.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
                    
                    // 将提示添加到按钮附近
                    document.body.appendChild(tooltip);
                    const rect = button.getBoundingClientRect();
                    tooltip.style.left = rect.left + (rect.width - tooltip.offsetWidth) / 2 + 'px';
                    tooltip.style.top = rect.top - tooltip.offsetHeight - 8 + 'px';

                    // 1.5秒后移除提示
                    setTimeout(() => {
                        tooltip.remove();
                    }, 1500);
                    return;
                }

                activeSalesChart = button.dataset.chart;
                document.querySelectorAll('.chart-switch-btn').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                renderSalesChart(window.fullSalesData);
            });
        });

        // 新增: 過濾數據的輔助函數 - 排除金額為0的交易
        function filterDataByDateRange(data, startDate, endDate) {
            return data.filter(d => {
                if (!d.jsDate) return false;
                if (parseFloat(d.amount) <= 0) return false; // 排除金額為0或負數的交易
                return d.jsDate >= startDate && d.jsDate <= endDate;
            });
        }

        function processAndRenderCharts(fullSalesData, startDate, endDate) {
            // 1. 篩選主期間數據 (使用新的輔助函數，已包含0元過濾和日期修正)
            const primaryFilteredData = filterDataByDateRange(fullSalesData, startDate, endDate);

            // --- 新增詳細日誌 ---
            console.log('[Debug] processAndRenderCharts:');
            // Use a timezone-neutral format for logging to avoid confusion
            const toLocalISOString = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
            console.log(`[Debug] Date Range Selected (Local): ${toLocalISOString(startDate)} to ${toLocalISOString(endDate)}`);
            console.log(`[Debug] Total items from server: ${fullSalesData.length}`);
            console.log(`[Debug] Filtered data count for this range: ${primaryFilteredData.length}`);
            if (primaryFilteredData.length > 0) {
                 console.log('[Debug] First item in filtered data:', primaryFilteredData[0]);
            } else {
                 console.log('[Debug] No data matched the selected date range.');
            }
            // --- 日誌結束 ---

            // 2. 聚合主期間數據
            const primaryData = aggregateData(primaryFilteredData);
            
            // 存儲聚合後的數據，包括已篩選的原始數據以供KPI使用
            currentChartData = { 
                primary: primaryData,
                primaryFiltered: primaryFilteredData
            };

            // 3. 繪製當前活動的圖表 (KPI渲染將在此函數中完成)
            renderActiveChart();
        }

        // 新增: 聚合數據的輔助函數
        function aggregateData(filteredData) {
            const dailyData = {};
            const storeData = {};
            const productData = {};
            const paymentData = {};
            const uniqueShops = new Set(); 

            filteredData.forEach(d => {
                const amount = parseFloat(d.amount) || 0;
                
                // 跳過金額為0或負數的交易
                if (amount <= 0) return;
                
                const y = d.jsDate.getFullYear();
                const m = String(d.jsDate.getMonth() + 1).padStart(2, '0');
                const day = String(d.jsDate.getDate()).padStart(2, '0');
                const fullDate = `${y}-${m}-${day}`;
                
                if (!dailyData[fullDate]) dailyData[fullDate] = 0;
                dailyData[fullDate] += amount;

                if (d.shopName) { // 增加一個檢查確保 shopName 存在
                    const shopName = String(d.shopName).trim(); // 標準化店鋪名稱
                    if (!storeData[shopName]) storeData[shopName] = 0;
                    storeData[shopName] += amount;
                    uniqueShops.add(shopName);
                }

                if (!productData[d.product]) productData[d.product] = 0;
                productData[d.product] += amount;

                if (!paymentData[d.payType]) paymentData[d.payType] = 0;
                paymentData[d.payType]++;
            });

            console.log(`[Debug] aggregateData: Found ${uniqueShops.size} unique shops.`);
            console.log('[Debug] Final aggregated storeData for chart:', storeData);
            
            return { dailyData, storeData, productData, paymentData };
        }

        function updateKpiCard(containerId, primaryValue, compareValue, isComparing, unit = '', isCurrency = true) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const formatOptions = isCurrency ? { maximumFractionDigits: 0 } : {};

            let innerHTML = `<p>${primaryValue.toLocaleString('en-US', formatOptions)}${unit}</p>`;

            // 只有在啟用比較模式且比較值大於0時才顯示差異
            if (isComparing && compareValue > 0) {
                const difference = primaryValue - compareValue;
                const percentageChange = (difference / compareValue) * 100;
                
                const arrow = difference >= 0 ? '▲' : '▼';
                const colorClass = difference >= 0 ? 'positive' : 'negative';
                const sign = difference >= 0 ? '+' : '';
                const tooltipText = `與對比期間相差: ${sign}${difference.toLocaleString('en-US', formatOptions)}${unit}`;

                innerHTML += `
                    <span class="kpi-comparison ${colorClass}" title="${tooltipText}">
                        ${arrow} ${percentageChange.toFixed(1)}%
                    </span>
                `;
            }

            container.innerHTML = innerHTML;
        }

        function renderActiveChart() {
            if (mainSalesChartInstance) {
                mainSalesChartInstance.destroy();
            }

            // --- 1. KPI Calculation & Rendering ---
            const primaryFiltered = currentChartData.primaryFiltered || [];
            const primaryTotalSales = primaryFiltered.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
            const primaryTotalTransactions = primaryFiltered.length;
            const primaryAvgTransactionValue = primaryTotalTransactions > 0 ? primaryTotalSales / primaryTotalTransactions : 0;
            
            let compareFilteredData = [];
            let comparisonIsActive = false;

            if (isCompareMode) {
                const compareStart = compareDatePickerInstance.getStartDate()?.dateInstance;
                const compareEnd = compareDatePickerInstance.getEndDate()?.dateInstance;

                if (compareStart && compareEnd) {
                    comparisonIsActive = true;
                    const fullSalesData = window.fullSalesData || [];
                    compareFilteredData = filterDataByDateRange(fullSalesData, compareStart, compareEnd);
                }
            }

            const compareTotalSales = compareFilteredData.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
            const compareTotalTransactions = compareFilteredData.length;
            const compareAvgTransactionValue = compareTotalTransactions > 0 ? compareTotalSales / compareTotalTransactions : 0;
            
            updateKpiCard('kpi-total-sales', primaryTotalSales, compareTotalSales, comparisonIsActive, ' 元', true);
            updateKpiCard('kpi-total-transactions', primaryTotalTransactions, compareTotalTransactions, comparisonIsActive, ' 筆', false);
            updateKpiCard('kpi-avg-transaction-value', primaryAvgTransactionValue, compareAvgTransactionValue, comparisonIsActive, ' 元', true);


            // --- 2. Chart Data Aggregation ---
            // The main data is already filtered. We just need to aggregate comparison data if active.
            if (comparisonIsActive) {
                 currentChartData.comparison = aggregateData(compareFilteredData);
                 currentChartData.comparisonFiltered = compareFilteredData;
            } else {
                delete currentChartData.comparison;
                delete currentChartData.comparisonFiltered;
            }

            // --- 3. Chart Rendering ---
            switch (activeSalesChart) {
                case 'daily':
                    renderDailySalesChart();
                    break;
                case 'store':
                    renderStoreSalesChart(
                        currentChartData.primary.storeData,
                        comparisonIsActive ? currentChartData.comparison?.storeData : null
                    );
                    break;
                case 'product':
                    renderProductSalesChart(
                        currentChartData.primary.productData,
                        comparisonIsActive ? currentChartData.comparison?.productData : null
                    );
                    break;
                case 'payment':
                    renderPaymentTypeChart(
                        currentChartData.primary.paymentData,
                        comparisonIsActive ? currentChartData.comparison?.paymentData : null
                    );
                    break;
            }
        }

        function aggregateByTimeUnit(data, unit, periodStartDate, periodEndDate) {
            const labels = [];
            const values = [];
            if (!data || data.length === 0 || !periodStartDate || !periodEndDate) {
                return { labels, values };
            }
            
            const formatShortDate = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

            let bucketStart = new Date(periodStartDate);
            
            // 確保起始時間是從0點開始
            if (unit !== '6h') {
                bucketStart.setHours(0, 0, 0, 0);
            }

            while (bucketStart <= periodEndDate) {
                let bucketEnd;
                let label;
                let nextBucketStart = new Date(bucketStart);

                switch (unit) {
                    case '6h':
                        bucketEnd = new Date(bucketStart.getTime() + (6 * 60 * 60 * 1000) - 1);
                        nextBucketStart.setHours(nextBucketStart.getHours() + 6);
                        const hour = bucketStart.getHours();
                        if (hour >= 0 && hour < 6) {
                            label = `${formatShortDate(bucketStart)}`;
                        } else if (hour >= 6 && hour < 12) {
                            label = '早上';
                        } else if (hour >= 12 && hour < 18) {
                            label = '中午';
                        } else { // 18-24
                            label = '晚上';
                        }
                        break;
                    case '2d':
                        nextBucketStart.setDate(nextBucketStart.getDate() + 2);
                        bucketEnd = new Date(nextBucketStart.getTime() - 1);
                        label = formatShortDate(bucketStart);
                        break;
                    default: // 'daily'
                        nextBucketStart.setDate(nextBucketStart.getDate() + 1);
                        bucketEnd = new Date(nextBucketStart.getTime() - 1);
                        label = formatShortDate(bucketStart);
                        break;
                }
                
                // 確保最後一個 bucket 不會超過期間結束日期
                if (bucketEnd > periodEndDate) {
                    bucketEnd = new Date(periodEndDate);
                }

                const amountInBucket = data
                    .filter(d => d.jsDate >= bucketStart && d.jsDate <= bucketEnd && parseFloat(d.amount) > 0)
                    .reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
                
                labels.push(label);
                values.push(amountInBucket);

                bucketStart = nextBucketStart;
                if(bucketStart > periodEndDate) break;
            }

            return { labels, values };
        }

        function renderDailySalesChart() {
            // 從 currentChartData 獲取數據
            const primaryStartDate = datePickerInstance.getStartDate().dateInstance;
            const primaryEndDate = datePickerInstance.getEndDate().dateInstance;
            const primaryFiltered = currentChartData.primaryFiltered || [];
            
            const adjustedPrimaryEndDate = new Date(primaryEndDate);
            adjustedPrimaryEndDate.setHours(23, 59, 59, 999);
            
            const primaryAgg = aggregateByTimeUnit(primaryFiltered, activeTimeUnit, primaryStartDate, adjustedPrimaryEndDate);

            let compareAgg = null;
            if (isCompareMode && currentChartData.comparisonFiltered) {
                const compareStartDate = compareDatePickerInstance.getStartDate().dateInstance;
                const compareEndDate = compareDatePickerInstance.getEndDate().dateInstance;
                const adjustedCompareEndDate = new Date(compareEndDate);
                adjustedCompareEndDate.setHours(23, 59, 59, 999);
                compareAgg = aggregateByTimeUnit(currentChartData.comparisonFiltered, activeTimeUnit, compareStartDate, adjustedCompareEndDate);
            }

            const maxLen = Math.max(primaryAgg.values.length, compareAgg ? compareAgg.values.length : 0);
            const labels = Array.from({ length: maxLen }, (_, i) => i + 1);

            const primaryDataset = [...primaryAgg.values, ...Array(maxLen - primaryAgg.values.length).fill(0)];

            const primaryLabel = document.getElementById('primaryPeriodLabel').textContent;
            const compareLabel = document.getElementById('comparePeriodLabel').textContent;

            const datasets = [{
                label: primaryLabel,
                data: primaryDataset,
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                fill: true,
                tension: 0.2, // 讓線圖平滑
                borderWidth: 2,
                pointBackgroundColor: 'rgba(54, 162, 235, 1)',
                pointRadius: 3,
                pointHoverRadius: 5
            }];

            if (compareAgg) {
                const comparisonDataset = [...compareAgg.values, ...Array(maxLen - compareAgg.values.length).fill(0)];
                datasets.push({
                    label: compareLabel,
                    data: comparisonDataset,
                    borderColor: 'rgba(170, 170, 170, 1)',
                    backgroundColor: 'rgba(170, 170, 170, 0.2)',
                    fill: true,
                    tension: 0.2, // 讓線圖平滑
                    borderDash: [5, 5],
                    borderWidth: 2,
                    pointBackgroundColor: 'rgba(170, 170, 170, 1)',
                    pointRadius: 3,
                    pointHoverRadius: 5
                });
            }

            const ctx = document.getElementById('mainSalesChart').getContext('2d');
            mainSalesChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                                            scales: {
                            x: {
                               title: {
                                   display: true,
                                   text: `時間單位: ${activeTimeUnit}`
                               },
                               ticks: {
                                   callback: function(value, index, ticks) {
                                       // `value` is the tick value. For a category axis, this is the index.
                                       const label = primaryAgg.labels[index];
                                       if (!label) return ''; // Avoid errors

                                       if (activeTimeUnit === '2d') {
                                           return index % 2 === 0 ? label : '';
                                       }
                                       
                                       return label;
                                   },
                                   autoSkip: false,
                                   maxRotation: 0,
                                   color: function(context) {
                                       const index = context.index;
                                       const label = primaryAgg.labels[index];
                                       if (!label) return '#666666';
                                       
                                       // 檢查是否為周末
                                       if (primaryAgg.dateMap && primaryAgg.dateMap[index]) {
                                           const date = primaryAgg.dateMap[index].start;
                                           const dayOfWeek = date.getDay(); // 0=周日, 6=周六
                                           if (dayOfWeek === 0 || dayOfWeek === 6) {
                                               return '#ff4444'; // 紅色
                                           }
                                       }
                                       
                                       return '#666666'; // 預設顏色
                                   }
                               }
                            },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return value.toLocaleString() + ' 元';
                                }
                            }
                        }
                    },
                    plugins: {
                        legend: {
                           display: true, // 顯示圖例以便區分
                           position: 'top',
                        },
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    const periodIndex = context[0].label;
                                    return `第 ${periodIndex} 區間`;
                                },
                                afterTitle: function(context) {
                                    const dataIndex = context[0].dataIndex;
                                    let footer = '';
                                    if(primaryAgg.labels[dataIndex]){
                                        footer += `${primaryLabel}: ${primaryAgg.labels[dataIndex]}\n`;
                                    }
                                    if(compareAgg && compareAgg.labels[dataIndex]){
                                        footer += `${compareLabel}: ${compareAgg.labels[dataIndex]}`;
                                    }
                                    return footer.trim();
                                },
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    let value = context.parsed.y || 0;
                                    return `${label}: ${value.toLocaleString()} 元`;
                                }
                            }
                        },
                        glassmorphismBackground: true
                    }
                }
            });
        }
        
        // 修正 renderStoreSalesChart
        function renderStoreSalesChart(primaryData, compareData) {
            // 依主線銷售額排序
            const allStoreNames = Object.keys(primaryData||{}).sort((a,b)=>(primaryData[b]||0)-(primaryData[a]||0));
            // 若有對比線，補上對比線有但主線沒有的分店（排在後面）
            if (compareData) {
                Object.keys(compareData).forEach(store => {
                    if (!allStoreNames.includes(store)) allStoreNames.push(store);
                });
            }
            // 生成 datasets
            const datasets = [];
            datasets.push({
                label: '主線',
                data: allStoreNames.map(store => primaryData[store] || 0),
                backgroundColor: 'rgba(54, 162, 235, 0.8)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            });
            if (compareData) {
                datasets.push({
                    label: '對比線',
                    data: allStoreNames.map(store => compareData[store] || 0),
                    backgroundColor: 'rgba(170, 170, 170, 0.7)',
                    borderColor: 'rgba(170, 170, 170, 1)',
                    borderWidth: 1
                });
            }
            const ctx = document.getElementById('mainSalesChart').getContext('2d');
            mainSalesChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: allStoreNames,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { callback: value => value.toLocaleString() + ' 元' }
                        }
                    },
                    plugins: {
                        legend: { display: !!compareData, position: 'top' },
                        glassmorphismBackground: true
                    }
                }
            });
        }

        // 修正 renderProductSalesChart
        function renderProductSalesChart(primaryData, compareData) {
            const ctx = document.getElementById('mainSalesChart').getContext('2d');
            
            // 計算每個產品的訂單筆數 - 排除金額為0的交易
            function calculateProductOrderCounts(filteredData) {
                const orderCounts = {};
                filteredData.forEach(d => {
                    if (d.product && parseFloat(d.amount) > 0) {
                        if (!orderCounts[d.product]) {
                            orderCounts[d.product] = 0;
                        }
                        orderCounts[d.product]++;
                    }
                });
                return orderCounts;
            }
            
            // 獲取當前篩選的數據來計算訂單筆數 - 排除金額為0的交易
            const mainFiltered = window.fullSalesData.filter(d => {
                const selectedStores = window._mainMultiSelect.selectedStores;
                const selectedProducts = window._mainMultiSelect.selectedProducts;
                if (selectedStores.length > 0 && !selectedStores.includes(d.shopName)) return false;
                if (selectedProducts.length > 0 && !selectedProducts.includes(d.product)) return false;
                if (!d.jsDate) return false;
                if (parseFloat(d.amount) <= 0) return false; // 排除金額為0或負數的交易
                return d.jsDate >= mainLine.start && d.jsDate <= mainLine.end;
            });

            let compareFilteredArray = [];
            let compareOrderCountsArray = [];
            
            if (isCompareMode && compareLines.length > 0) {
                compareFilteredArray = compareLines.map(line => {
                    return window.fullSalesData.filter(d => {
                        const selectedStores = line.multiSelect.selectedStores;
                        const selectedProducts = line.multiSelect.selectedProducts;
                        if (selectedStores.length > 0 && !selectedStores.includes(d.shopName)) return false;
                        if (selectedProducts.length > 0 && !selectedProducts.includes(d.product)) return false;
                        if (!d.jsDate) return false;
                        if (parseFloat(d.amount) <= 0) return false;
                        return d.jsDate >= line.start && d.jsDate <= line.end;
                    });
                });
                compareOrderCountsArray = compareFilteredArray.map(filtered => calculateProductOrderCounts(filtered));
            }
            
            const mainOrderCounts = calculateProductOrderCounts(mainFiltered);
            
            if (compareData) {
                // 100% 堆疊 bar
                const allLabels = Array.from(new Set([
                    ...Object.keys(primaryData||{}),
                    ...Object.keys(compareData||{})
                ]));
                const totalPrimary = Object.values(primaryData).reduce((sum, v) => sum + v, 0);
                const totalCompare = Object.values(compareData).reduce((sum, v) => sum + v, 0);
                const datasets = allLabels.map(label => {
                    const primaryValue = primaryData[label] || 0;
                    const compareValue = compareData[label] || 0;
                    const primaryPct = totalPrimary > 0 ? (primaryValue / totalPrimary) * 100 : 0;
                    const comparePct = totalCompare > 0 ? (compareValue / totalCompare) * 100 : 0;
                    return {
                        label: label,
                        data: [primaryPct, comparePct],
                        backgroundColor: generateConsistentColors([label])[0],
                        originalValues: [primaryValue, compareValue],
                        orderCounts: [mainOrderCounts[label] || 0, compareOrderCounts[label] || 0]
                    };
                });
                mainSalesChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['主線', '對比線'],
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true },
                            y: {
                                stacked: true,
                                max: 100,
                                ticks: { callback: value => value.toFixed(0) + '%' }
                            }
                        },
                        plugins: {
                            legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const dataset = context.chart.data.datasets[context.datasetIndex];
                                        const originalValue = dataset.originalValues[context.dataIndex];
                                        const percentage = context.parsed.y;
                                        const orderCount = dataset.orderCounts[context.dataIndex];
                                        return `${dataset.label}: ${originalValue.toLocaleString()} 元 (${percentage.toFixed(1)}%) - ${orderCount} 筆`;
                                    }
                                }
                            },
                            glassmorphismBackground: true
                        }
                    }
                });
                return;
            }
            // 單一資料：圓餅圖
            const sortedProducts = Object.entries(primaryData).sort(([,a],[,b]) => b-a);
            const topN = 10;
            const topProducts = sortedProducts.slice(0, topN);
            const otherAmount = sortedProducts.slice(topN).reduce((sum, [, amount]) => sum + amount, 0);
            const labels = topProducts.map(([name]) => name);
            const data = topProducts.map(([,amount]) => amount);
            const orderCounts = topProducts.map(([name]) => mainOrderCounts[name] || 0);
            
            if (otherAmount > 0) {
                labels.push('其他');
                data.push(otherAmount);
                // 計算"其他"類別的訂單筆數
                const otherOrderCount = Object.keys(mainOrderCounts).filter(product => 
                    !labels.slice(0, -1).includes(product)
                ).reduce((sum, product) => sum + mainOrderCounts[product], 0);
                orderCounts.push(otherOrderCount);
            }
            
            mainSalesChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: generateConsistentColors(labels),
                        orderCounts: orderCounts
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12 } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    let value = context.raw || 0;
                                    const total = context.chart.getDatasetMeta(0).total;
                                    const percentage = total > 0 ? (value / total * 100).toFixed(1) : 0;
                                    const orderCount = context.chart.data.datasets[0].orderCounts[context.dataIndex] || 0;
                                    return `${label}: ${value.toLocaleString()} 元 (${percentage}%) - ${orderCount} 筆`;
                                }
                            }
                        },
                        glassmorphismBackground: true
                    }
                }
            });
        }

        // 修正 renderPaymentTypeChart
        function renderPaymentTypeChart(primaryData, compareData) {
            const ctx = document.getElementById('mainSalesChart').getContext('2d');
            if (compareData) {
                // 100% 堆疊 bar
                const allLabels = Array.from(new Set([
                    ...Object.keys(primaryData||{}),
                    ...Object.keys(compareData||{})
                ]));
                const totalPrimary = Object.values(primaryData).reduce((sum, v) => sum + v, 0);
                const totalCompare = Object.values(compareData).reduce((sum, v) => sum + v, 0);
                const datasets = allLabels.map(label => {
                    const primaryValue = primaryData[label] || 0;
                    const compareValue = compareData[label] || 0;
                    const primaryPct = totalPrimary > 0 ? (primaryValue / totalPrimary) * 100 : 0;
                    const comparePct = totalCompare > 0 ? (compareValue / totalCompare) * 100 : 0;
                    return {
                        label: label,
                        data: [primaryPct, comparePct],
                        backgroundColor: generateConsistentColors([label])[0],
                        originalValues: [primaryValue, compareValue]
                    };
                });
                mainSalesChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ['主線', '對比線'],
                        datasets: datasets
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true },
                            y: {
                                stacked: true,
                                max: 100,
                                ticks: { callback: value => value.toFixed(0) + '%' }
                            }
                        },
                        plugins: {
                            legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const dataset = context.chart.data.datasets[context.datasetIndex];
                                        const originalValue = dataset.originalValues[context.dataIndex];
                                        const percentage = context.parsed.y;
                                        return `${dataset.label}: ${originalValue.toLocaleString()} 筆 (${percentage.toFixed(1)}%)`;
                                    }
                                }
                            },
                            glassmorphismBackground: true
                        }
                    }
                });
                return;
            }
            // 單一資料：圓餅圖
            const labels = Object.keys(primaryData);
            const data = Object.values(primaryData);
            mainSalesChartInstance = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: labels,
                    datasets: [{
                        data: data,
                        backgroundColor: generateConsistentColors(labels)
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12 } },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.label || '';
                                    let value = context.raw || 0;
                                    const total = context.chart.getDatasetMeta(0).total;
                                    const percentage = total > 0 ? (value / total * 100).toFixed(1) : 0;
                                    return `${label}: ${value.toLocaleString()} 筆 (${percentage}%)`;
                                }
                            }
                        },
                        glassmorphismBackground: true
                    }
                }
            });
        }

        // 更新排序按鈕狀態
        function updateSortButtonsState(activeButtonId) {
            document.querySelectorAll('.toolbar-button[data-sort]').forEach(button => {
                button.setAttribute('data-active', 'false');
            });
            if (activeButtonId) {
                const buttonElement = document.getElementById(activeButtonId);
                if (buttonElement) {
                    buttonElement.setAttribute('data-active', 'true');
                }
            }
        }
        
        // 渲染機台卡片
        function renderStoreCards(storeGroupsArray, storeNotesAndAddresses, salesData) {
            const chartContainer = document.getElementById('chartContainer');
            chartContainer.innerHTML = '';
            
            storeGroupsArray.forEach(({ key, store, machineId, lastUpdated, lastCleaned, products, totalQuantity }) => {
                const noteData = storeNotesAndAddresses[key] || { address: '', note: '', sales: 0 };
                const maxCapacity = 50;
                const usagePercentage = Math.min(Math.round((totalQuantity / maxCapacity) * 100), 100);
                
                // 新增：對日期進行防禦性檢查
                const lastUpdatedText = lastUpdated ? lastUpdated.split(' ')[0] : 'N/A';
                const lastCleanedText = lastCleaned ? lastCleaned.split(' ')[0] : 'N/A';
                
                // --- NEW: Get the last 30 days sales for this specific store ---
                const machineSalesTotal = salesData[store] ? salesData[store].totalSales : 0;
                // 新增：計算該機台過去一個月銷售份數
                let machineSalesCount = 0;
                if (salesData[store]) {
                    // 將所有產品的 count 相加
                    machineSalesCount = Object.values(salesData[store])
                        .filter(v => typeof v === 'object' && v.count !== undefined)
                        .reduce((sum, v) => sum + (v.count || 0), 0);
                }
                
                // 創建卡片
                const cardDiv = document.createElement('div');
                cardDiv.className = 'chart-card';
                cardDiv.id = `card-${key}`;
                
                // 圓餅圖視圖內容
                cardDiv.innerHTML = `
                    <div class="chart-card-title">
                        ${store}<br>${machineId}
                        ${(machineSalesTotal > 0 || machineSalesCount > 0) ? `<div class="sales-info">過去一個月銷售: ${machineSalesTotal.toLocaleString()} 元 / ${machineSalesCount} 份</div>` : ''}
                    </div>
                    <div class="chart-card-chart">
                        <canvas id="chart-${key}"></canvas>
                    </div>
                    <div class="chart-card-info">
                        <div>使用量: ${totalQuantity}/${maxCapacity} (${usagePercentage}%)</div>
                        <div>補貨: ${lastUpdatedText}</div>
                    </div>
                `;
                
                // 添加詳細資料視圖內容
                const detailDiv = document.createElement('div');
                detailDiv.className = 'detail-content';
                
                let detailHtml = `
                    <div class="detail-dates">
                        <div>補貨: ${lastUpdatedText}</div>
                    </div>
                `;
                
                if (noteData.address || noteData.note) {
                    if (noteData.address) {
                        detailHtml += `<div class="detail-address">地址: ${noteData.address}</div>`;
                    }
                    if (noteData.note) {
                        detailHtml += `<div class="detail-address">備註: ${noteData.note}</div>`;
                    }
                }
                
                // --- NEW: 銷售排名邏輯 (per-machine, includes sold-out items) ---
                const machineSalesData = salesData ? salesData[store] : null;

                // 創建一個庫存產品的查找表，方便快速獲取庫存量
                const inStockProducts = new Map(products.map(p => [p.name, p.quantity]));
                
                // 獲取所有獨一無二的產品名稱，來源於庫存和銷售兩個列表 (過濾掉空名稱)
                const allProductNames = new Set([
                    ...products.map(p => p.name).filter(Boolean), 
                    ...(machineSalesData ? Object.keys(machineSalesData) : [])
                ]);

                let processedProducts = [];
                allProductNames.forEach(productName => {
                    const salesInfo = machineSalesData ? machineSalesData[productName] : null;
                    processedProducts.push({
                        name: productName,
                        quantity: inStockProducts.get(productName) || 0, // 如果不在庫存列表，數量為0
                        sales: salesInfo ? salesInfo.count : 0,
                        lastSoldDate: salesInfo ? salesInfo.lastSoldDate : ''
                    });
                });

                if (machineSalesData) {
                    processedProducts.sort((a, b) => b.sales - a.sales);
                }

                const medals = ['🥇', '🥈', '🥉'];
                const productsWithSales = processedProducts.filter(p => p.sales > 0);
                const productsWithoutSales = processedProducts.filter(p => p.sales === 0);

                // --- 渲染前三名 (包括空位) ---
                for (let i = 0; i < 3; i++) {
                    const product = productsWithSales[i];
                    if (product) {
                        // 如果有對應排名的產品
                        let tooltipParts = [`過去一個月銷量為 ${product.sales}`];
                        let quantityDisplay = product.quantity;

                        if (product.quantity === 0) {
                            tooltipParts.push(`已在 ${product.lastSoldDate} 完售，請盡早補貨`);
                            quantityDisplay = '⚠️';
                        }
                        
                        detailHtml += `
                            <div class="detail-item">
                                <div>${medals[i]} ${product.name}</div>
                                <div>${quantityDisplay}</div>
                                <span class="detail-tooltip">${tooltipParts.join('，')}</span>
                            </div>
                        `;
                    } else {
                        // 如果沒有對應排名的產品，顯示空位
                        const tooltip = `該機台過去一個月只銷售 ${productsWithSales.length} 樣產品`;
                        detailHtml += `
                            <div class="detail-item">
                                <div>${medals[i]} -</div>
                                <div>-</div>
                                <span class="detail-tooltip">${tooltip}</span>
                            </div>
                        `;
                    }
                }

                // --- 渲染其他已售出產品 (排名第四及以後) ---
                if (productsWithSales.length > 3) {
                     productsWithSales.slice(3).forEach(product => {
                        let quantityDisplay = product.quantity;
                        let tooltipParts = [`過去一個月銷量為 ${product.sales}`];

                        if (product.quantity === 0) {
                            quantityDisplay = '⚠️';
                            tooltipParts.push(`已在 ${product.lastSoldDate} 完售，請盡早補貨`);
                        }

                        detailHtml += `
                            <div class="detail-item">
                                <div>${product.name}</div>
                                <div>${quantityDisplay}</div>
                                <span class="detail-tooltip">${tooltipParts.join('，')}</span>
                            </div>
                        `;
                    });
                }
               
                // --- 渲染無銷售紀錄的產品 ---
                productsWithoutSales.forEach(product => {
                     detailHtml += `
                        <div class="detail-item">
                            <div>${product.name}</div>
                            <div>${product.quantity}</div>
                            <span class="detail-tooltip">該產品於過去一個月未有銷售紀錄</span>
                        </div>
                    `;
                });
                
                detailHtml += `
                    <div class="detail-total">
                        <div>總計</div>
                        <div>${totalQuantity}</div>
                    </div>
                `;
                
                detailDiv.innerHTML = detailHtml;
                cardDiv.appendChild(detailDiv);
                
                chartContainer.appendChild(cardDiv);
                
                // 創建圓餅圖
                setTimeout(() => {
                    try {
                        createDonutChart(key, products);
                    } catch (error) {
                        console.error(`創建圓餅圖失敗 ${key}:`, error);
                    }
                }, 100);


            });
        }
        
        // 另存為HTML
        document.getElementById('saveAsHtmlButton').addEventListener('click', function() {
            try {
                // 獲取當前數據現在直接从全局变量获取
                const data = window.inventoryData;
                const notes = window.storeNotesAndAddresses;
                const salesData = window.salesData;
                const selectedSalesMonth = window.selectedSalesMonth;
                const updateTime = window.updateTime;
                const dailySalesTrend = window.dailySalesTrend;
                const fullSalesData = window.fullSalesData;
                const hiddenStores = window.hiddenStores;
                
                if (!data) {
                    throw new Error('無法獲取庫存數據');
                }
                
                // 創建一個新的HTML文檔
                const newDoc = document.implementation.createHTMLDocument('庫存圓餅圖');
                
                // 複製當前文檔的內容
                newDoc.documentElement.innerHTML = document.documentElement.innerHTML;
                
                // 創建數據腳本，確保使用正確的JSON字符串格式
                const scriptContent = `
                    window.embeddedData = ${JSON.stringify(data)};
                    window.embeddedNotes = ${JSON.stringify(notes)};
                    window.embeddedSalesData = ${JSON.stringify(salesData)};
                    window.embeddedSalesMonth = ${JSON.stringify(selectedSalesMonth)};
                    window.embeddedColorMap = ${JSON.stringify(globalProductColorMap)};
                    window.embeddedUpdateTime = ${JSON.stringify(updateTime)};
                    window.embeddedDailySalesTrend = ${JSON.stringify(dailySalesTrend)};
                    window.embeddedFullSalesData = ${JSON.stringify(fullSalesData)};
                    window.embeddedHiddenStores = ${JSON.stringify(hiddenStores)};
                `;
                
                // 創建並插入腳本元素
                const dataScript = newDoc.createElement('script');
                dataScript.textContent = scriptContent;
                
                // 確保腳本在其他腳本之前插入
                const firstScript = newDoc.getElementsByTagName('script')[0];
                firstScript.parentNode.insertBefore(dataScript, firstScript);
                
                // 創建並下載文件
                const blob = new Blob([newDoc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = '庫存_' + new Date().toISOString().split('T')[0] + '.html';
                a.click();
                URL.revokeObjectURL(url);
                
                console.log('文件保存成功');
            } catch (error) {
                console.error('保存文件時出錯:', error);
                alert('保存失敗: ' + error.message);
            }
        });
        
        // 截圖按鈕事件處理
        document.getElementById('captureButton').addEventListener('click', function() {
            const loader = document.getElementById('screenshotLoader');
            const body = document.body;

            // 準備截圖
            loader.style.display = 'flex';
            body.classList.add('is-capturing');

            // 稍微延遲以確保樣式應用和渲染穩定
            setTimeout(() => {
                html2canvas(body, {
                    scale: 2, // 提高分辨率
                    useCORS: true,
                    allowTaint: true, // 允許跨域圖片
                    foreignObjectRendering: true, // 啟用外部物件渲染
                    backgroundColor: getComputedStyle(body).backgroundColor, // 使用頁面背景色
                    logging: false, // 關閉日誌以提升性能
                    onclone: (clonedDoc) => {
                        // 在克隆的文檔中，隱藏加載動畫本身，確保它不會出現在截圖中
                        const loaderInClone = clonedDoc.getElementById('screenshotLoader');
                        if (loaderInClone) {
                            loaderInClone.style.display = 'none';
                        }
                        
                        // 確保所有圖表都正確渲染
                        const charts = clonedDoc.querySelectorAll('canvas');
                        charts.forEach(canvas => {
                            if (canvas.chart) {
                                canvas.chart.resize();
                            }
                        });
                    }
                }).then(canvas => {
                    try {
                        const url = canvas.toDataURL('image/png', 1.0);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `庫存截圖_${new Date().toISOString().split('T')[0]}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url); // 清理記憶體
                    } catch (error) {
                        console.error('生成下載連結失敗:', error);
                        alert('截圖生成成功，但下載失敗: ' + error.message);
                    }
                }).catch(error => {
                    console.error('截圖失敗:', error);
                    alert('截圖失敗: ' + error.message);
                }).finally(() => {
                    // 無論成功或失敗，都進行清理
                    loader.style.display = 'none';
                    body.classList.remove('is-capturing');
                });
            }, 300); // 增加延遲到300毫秒確保渲染完成
        });
        
        // 列印
        document.getElementById('printButton').addEventListener('click', function() {
            window.print();
        });
        
        // 修改視圖切換按鈕事件處理
        let currentViewMode = 'chart';
        const toggleViewButton = document.getElementById('toggleViewModeButton');
        
        function updateViewModeButton() {
            const icon = toggleViewButton.querySelector('i');
            const tooltip = toggleViewButton.querySelector('.tooltip');
            
            if (currentViewMode === 'chart') {
                icon.className = 'fas fa-table';
                tooltip.textContent = '切換詳細資料視圖';
            } else {
                icon.className = 'fas fa-chart-pie';
                tooltip.textContent = '切換圓餅圖視圖';
            }
        }

        toggleViewButton.addEventListener('click', function() {
            const cards = document.querySelectorAll('.chart-card');
            
            if (currentViewMode === 'chart') {
                cards.forEach(card => card.classList.add('detail-view'));
                currentViewMode = 'detail';
            } else {
                cards.forEach(card => card.classList.remove('detail-view'));
                currentViewMode = 'chart';
                
                // 重新繪製圓餅圖
                setTimeout(() => {
                    const data = window.inventoryData; // 使用全局數據
                    if (data) {
                        const storeGroups = groupDataByStore(data);
                        for (const storeKey in storeGroups) {
                            try {
                                createDonutChart(storeKey, storeGroups[storeKey].products);
                            } catch (error) {
                                console.error(`重新繪製圓餅圖失敗 ${storeKey}:`, error);
                            }
                        }
                    }
                }, 100);
            }
            
            updateViewModeButton();
        });
        
        // 將數據按機台分組
        function groupDataByStore(data) {
            if (!data || data.length === 0) return {};
            
            // 對數據進行預處理，移除重複的機台信息項
            const cleanedData = data.filter(item => {
                return item.productName !== item.store;
            });
            
            // 按機台分組
            const storeGroups = {};
            cleanedData.forEach(item => {
                const storeKey = `${item.store}-${item.machineId}`;
                if (!storeGroups[storeKey]) {
                    storeGroups[storeKey] = {
                        store: item.store,
                        machineId: item.machineId,
                        lastUpdated: item.lastUpdated,
                        lastCleaned: item.lastCleaned,
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
            
            return storeGroups;
        }
        
        // 載入數據並顯示圖表
        window.addEventListener('DOMContentLoaded', async function() {
            // 新增: 設置報告標題
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const salesReportTitle = document.getElementById('salesReportTitle');
            if(salesReportTitle) {
                salesReportTitle.textContent = `${year}-${month}-${day} 銷售總覽`;
            }

            try {
                console.log('[Debug] DOMContentLoaded: Starting data load process...');
                await loadAllData(); // 使用新的異步加載函數
                
                // 檢查數據是否存在
                if (window.inventoryData) {
                    console.log('[Debug] DOMContentLoaded: Data loaded. Calling displayCharts and setupSalesTrendTab...');
                // 設置庫存視圖
                    displayCharts(window.inventoryData);
                // 設置銷售趨勢視圖
                setupSalesTrendTab(window.fullSalesData);
                    console.log('[Debug] DOMContentLoaded: Render functions called.');
            } else {
                    console.error('[Debug] DOMContentLoaded: window.inventoryData is missing after loadAllData.');
                    throw new Error('數據未成功加載。');
                }
            } catch (error) {
                console.error('[Debug] DOMContentLoaded: Caught an error during initialization.', error);
                document.getElementById('chartContainer').innerHTML = '<p>沒有數據可顯示，請返回主頁面重新生成</p>';
                document.getElementById('summaryText').textContent = '無法載入數據';
                const loadingDiv = document.querySelector('.loading');
                if (loadingDiv) {
                    loadingDiv.style.display = 'none';
                }
            }
        });



        // 生成建議按鈕點擊事件
        generateSuggestionButton.addEventListener('click', async () => {
            if (await isDataUpdating()) {
                suggestionResultContainer.innerHTML = '<p style="color: orange; text-align: center;">資料正在更新，請稍後嘗試</p>';
                return;
            }
            if (!activeSuggestionStoreKey) return;
            if (isFirstRequest) {
                suggestionResultContainer.innerHTML = '<div class="loading" style="position: static; height: 100px;"></div>';
            }
            try {
                const response = await fetch(`/api/replenishment-suggestion/${activeSuggestionStoreKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        strategy: selectedStrategy,
                        reserve_slots: reserveSlotsInput.value || 0,
                        only_add: onlyAddCheckbox.checked,
                        max_total_qty: maxTotalQtyInput.value || 50
                    })
                });

                if (!response.ok) {
                    if (response.status === 503) {
                        throw new Error('資料正在更新，請稍後嘗試');
                    }
                    throw new Error(`伺服器錯誤: ${response.statusText}`);
                }

                const result = await response.json();
                if (result.success) {
                    displaySuggestionResult(result);
                } else {
                    throw new Error(result.message || '生成建議失敗');
                }
                isFirstRequest = false;
            } catch (error) {
                suggestionResultContainer.innerHTML = `<p style="color: red; text-align: center;">錯誤: ${error.message}</p>`;
            }
        });
        
        // 顯示建議結果的函數
        function displaySuggestionResult(result) {
            const { suggestion, message } = result;
            // 新增：檢查是否有警告訊息
            if (result.warning) {
                suggestionWarning.style.display = '';
                suggestionWarning.textContent = result.warning;
            } else {
                suggestionWarning.style.display = 'none';
                suggestionWarning.textContent = '';
            }
            if (message) {
                 suggestionResultContainer.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 20px;">${message}</p>`;
                 return;
            }

            let tableHTML = `
                <table class="suggestion-result-table">
                    <thead>
                        <tr>
                            <th>產品名稱</th>
                            <th>30天銷量</th>
                            <th>目前庫存</th>
                            <th>建議數量</th>
                            <th>調整</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            let totalCurrent = 0;
            let totalSuggested = 0;

            suggestion.forEach(item => {
                const adjustment = item.suggestedQty - item.currentQty;
                const adjustClass = adjustment > 0 ? 'positive' : (adjustment < 0 ? 'negative' : '');
                const adjustSign = adjustment > 0 ? '+' : '';
                
                totalCurrent += item.currentQty;
                totalSuggested += item.suggestedQty;

                tableHTML += `
                    <tr>
                        <td>${item.productName}</td>
                        <td>${item.salesCount30d}</td>
                        <td>${item.currentQty}</td>
                        <td>${item.suggestedQty}</td>
                        <td class="qty-adjust ${adjustClass}">${adjustSign}${adjustment}</td>
                    </tr>
                `;
            });

            tableHTML += `
                    </tbody>
                    <tfoot>
                        <tr style="font-weight: bold; border-top: 2px solid #ddd;">
                            <td>總計</td>
                            <td></td>
                            <td>${totalCurrent}</td>
                            <td>${totalSuggested}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            `;

            suggestionResultContainer.innerHTML = tableHTML;
        }

        // 添加教學區塊的展開/收合功能
        document.querySelector('.tutorial-header').addEventListener('click', function() {
            const tutorial = this.parentElement;
            const content = tutorial.querySelector('.tutorial-content');
            const icon = this.querySelector('.fa-chevron-down');
            
            tutorial.classList.toggle('open');
            
            // 更新箭頭圖標
            if (tutorial.classList.contains('open')) {
                icon.style.transform = 'rotate(180deg)';
            } else {
                icon.style.transform = 'rotate(0deg)';
            }
        });

        // 分頁切換邏輯
        document.querySelectorAll('.tab-link').forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.tab;

                // 更新按鈕狀態
                document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                // 更新內容顯示
                document.querySelectorAll('.tab-content').forEach(content => {
                    if (content.id === tabId) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
            });
        });

        // 新增：銷售趨勢頁面截圖按鈕
        document.getElementById('captureSalesTabButton').addEventListener('click', function() {
            const loader = document.getElementById('screenshotLoader');
            const body = document.body;
            
            // 準備截圖
            loader.style.display = 'flex';
            body.classList.add('is-capturing', 'is-capturing-sales', 'is-capturing-sales-wide');

            // 強制圖表重新計算尺寸
            if (mainSalesChartInstance) {
                mainSalesChartInstance.resize();
            }

            // 稍微延遲以確保圖表渲染完成
            setTimeout(() => {
                html2canvas(body, {
                    scale: 2, // 提高分辨率
                    useCORS: true,
                    allowTaint: true, // 允許跨域圖片
                    foreignObjectRendering: true, // 啟用外部物件渲染
                    backgroundColor: getComputedStyle(body).backgroundColor,
                    logging: false, // 關閉日誌以提升性能
                    onclone: (clonedDoc) => {
                        // 在克隆的文檔中，隱藏加載動畫本身
                        const loaderInClone = clonedDoc.getElementById('screenshotLoader');
                        if (loaderInClone) {
                            loaderInClone.style.display = 'none';
                        }
                        
                        // 確保所有圖表都正確渲染
                        const charts = clonedDoc.querySelectorAll('canvas');
                        charts.forEach(canvas => {
                            if (canvas.chart) {
                                canvas.chart.resize();
                            }
                        });
                    }
                }).then(canvas => {
                    try {
                        const reportTitle = document.getElementById('salesReportTitle').textContent.trim() || '銷售趨勢報告';
                        const url = canvas.toDataURL('image/png', 1.0);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${reportTitle}_${new Date().toISOString().split('T')[0]}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url); // 清理記憶體
                    } catch (error) {
                        console.error('生成下載連結失敗:', error);
                        alert('截圖生成成功，但下載失敗: ' + error.message);
                    }
                }).catch(error => {
                    console.error('截圖失敗:', error);
                    alert('截圖失敗: ' + error.message);
                }).finally(() => {
                    // 清理
                    loader.style.display = 'none';
                    body.classList.remove('is-capturing', 'is-capturing-sales', 'is-capturing-sales-wide');
                    
                    // 將圖表尺寸恢復正常
                    if (mainSalesChartInstance) {
                        mainSalesChartInstance.resize();
                    }
                });
            }, 400); // 增加延遲到400毫秒確保圖表完全渲染
        });

        toggleAdvancedOptionsButton.addEventListener('click', () => {
            if (advancedOptionsTable.style.display === 'none') {
                advancedOptionsTable.style.display = '';
            } else {
                advancedOptionsTable.style.display = 'none';
            }
        });

        // Chart.js Glassmorphism 背景 Plugin
        Chart.register({
            id: 'glassmorphismBackground',
            beforeDraw: function(chart, args, options) {
                const {ctx, width, height} = chart;
                ctx.save();
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = window.chartGlassBg || 'rgba(255,255,255,0.18)';
                ctx.filter = 'blur(4px)';
                ctx.fillRect(0, 0, width, height);
                ctx.filter = 'none';
                ctx.restore();
            }
        });

        // KPI 顯示主線數據，對比增減以最後一條對比線為準
        function renderKPI(mainFiltered, compareFiltered) {
            // 主線
            const totalSales = mainFiltered.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
            const totalTransactions = mainFiltered.length;
            const avgTransaction = totalTransactions > 0 ? totalSales / totalTransactions : 0;
            // 對比線
            let compareSales = 0, compareTransactions = 0, compareAvg = 0;
            if (compareFiltered && compareFiltered.length > 0) {
                compareSales = compareFiltered.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
                compareTransactions = compareFiltered.length;
                compareAvg = compareTransactions > 0 ? compareSales / compareTransactions : 0;
            }
            // 更新KPI
            function kpiHtml(main, compare, unit, isCurrency) {
                let html = `<p>${isCurrency ? main.toLocaleString() : main}${unit}</p>`;
                if (compare > 0) {
                    const diff = main - compare;
                    const pct = (diff / compare) * 100;
                    const arrow = diff >= 0 ? '▲' : '▼';
                    const color = diff >= 0 ? 'positive' : 'negative';
                    html += `<span class="kpi-comparison ${color}" title="與對比期間相差: ${(diff>=0?'+':'')}${diff.toLocaleString()}${unit}">${arrow} ${pct.toFixed(1)}%</span>`;
                }
                return html;
            }
            document.getElementById('kpi-total-sales').innerHTML = kpiHtml(totalSales, compareSales, ' 元', true);
            document.getElementById('kpi-total-transactions').innerHTML = kpiHtml(totalTransactions, compareTransactions, ' 筆', false);
            document.getElementById('kpi-avg-transaction-value').innerHTML = kpiHtml(avgTransaction, compareAvg, ' 元', true);
        }