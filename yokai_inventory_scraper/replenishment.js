// 全局變量
let selectedWarehouses = new Set();
let selectedMachines = new Set();
let warehouseData = [];
let inventoryData = [];

// 初始化補貨頁面
async function initReplenishmentTab() {
    console.log('Starting to initialize replenishment tab...');
    // 加載倉庫數據
    try {
        console.log('Fetching warehouse data...');
        const response = await fetch('/api/warehouses');
        console.log('Warehouse API response:', response.status);
        warehouseData = await response.json();
        console.log('Warehouse data received:', warehouseData);
        renderWarehouseList();
        console.log('Warehouse list rendered');
    } catch (error) {
        console.error('Error loading warehouse data:', error);
    }

    // 加載機台數據
    try {
        const response = await fetch('/get-data');
        const result = await response.json();
        if (result.success) {
            inventoryData = result.data;
            renderMachineList();
        }
    } catch (error) {
        console.error('Error loading inventory data:', error);
    }

    // 添加事件監聽器
    document.getElementById('generateReplenishmentButton').addEventListener('click', generateReplenishmentSuggestion);
}

// 渲染倉庫列表
function renderWarehouseList() {
    const warehouseList = document.getElementById('warehouseList');
    
    // 獲取唯一的倉庫名稱和其庫存數據
    const uniqueWarehouses = [...new Set(warehouseData.map(w => w.warehouseName))];
    
    warehouseList.innerHTML = uniqueWarehouses.map(warehouse => {
        // 獲取該倉庫的所有產品
        const warehouseProducts = warehouseData.filter(w => w.warehouseName === warehouse);
        
        // 生成庫存預覽HTML
        const inventoryPreviewHtml = warehouseProducts
            .map(product => `
                <div class="inventory-item">
                    <span>${product.productName}</span>
                    <span>${product.quantity || 0} 個</span>
                </div>
            `).join('');

        const displayWarehouse = window.__maskFields ? window.__maskFields.getOrCreate('warehouse', warehouse) : warehouse;
        return `
            <div class="warehouse-card" data-warehouse="${warehouse}">
                <div class="warehouse-header">
                    <span class="warehouse-name">${displayWarehouse}</span>
                    <span class="warehouse-stats">
                        <i class="fas fa-box"></i> ${warehouseProducts.length} 個產品
                    </span>
                </div>
                <div class="warehouse-preview">
                    ${inventoryPreviewHtml}
                </div>
            </div>
        `;
    }).join('');

    // 添加事件監聽器
    document.querySelectorAll('.warehouse-card').forEach(card => {
        card.addEventListener('click', e => {
            // 移除其他卡片的選中狀態
            document.querySelectorAll('.warehouse-card').forEach(c => c.classList.remove('selected'));
            // 選中當前卡片
            card.classList.add('selected');
            // 更新選中的倉庫
            selectedWarehouses.clear();
            selectedWarehouses.add(card.dataset.warehouse);
        });
    });
}

// 渲染機台列表
function renderMachineList() {
    const machineList = document.getElementById('machineList');
    
    // 按照地區分組機台
    const machinesByRegion = {};
    
    // 遍歷所有機台並按地區分組
    inventoryData.forEach(item => {
        const machineKey = `${item.store}-${item.machineId}`;
        if (item.address) {
            const region = item.address.substring(0, 3); // 取地址前三個字作為地區
            if (!machinesByRegion[region]) {
                machinesByRegion[region] = new Set();
            }
            machinesByRegion[region].add(machineKey);
        }
    });
    
    // 按地區名稱排序（台北市、新竹市、桃園市等）
    const sortedRegions = Object.keys(machinesByRegion).sort();
    
    // 生成HTML，每個地區一個區塊
    machineList.innerHTML = sortedRegions.map(region => {
        const machines = [...machinesByRegion[region]];
        
        // 該地區的所有機台HTML
        const machinesHtml = machines.map(machine => {
            const [store, machineId] = machine.split('-');
            const machineData = inventoryData.find(item => 
                item.store === store && item.machineId === machineId
            );
            const productCount = inventoryData.filter(item => 
                item.store === store && item.machineId === machineId
            ).length;
            
            const address = machineData?.address || '';
            const note = machineData?.note ? `(${machineData.note})` : '';

            const displayStore = window.__maskFields ? window.__maskFields.getOrCreate('store', store) : store;
            const displayMachine = window.__maskFields ? window.__maskFields.getOrCreate('machine', machineId) : machineId;
            const displayAddress = window.__maskFields ? window.__maskFields.getOrCreate('address', address) : address;
            const displayNote = window.__maskFields ? (note ? window.__maskFields.getOrCreate('note', note) : '') : note;

            return `
                <div class="machine-card" data-machine="${machine}">
                    <div class="machine-info">
                        <div class="machine-name">
                            <i class="fas fa-robot"></i>
                            ${displayStore} - ${displayMachine}
                        </div>
                        <div class="machine-detail">
                            <div><i class="fas fa-map-marker-alt"></i> ${displayAddress}</div>
                            ${displayNote ? `<div><i class="fas fa-info-circle"></i> ${displayNote}</div>` : ''}
                            <div><i class="fas fa-box"></i> ${productCount} 個產品</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 返回該地區的完整HTML
        return `
            <div class="region-section">
                <h3 class="region-title"><i class="fas fa-map-marked-alt"></i> ${region}</h3>
                <div class="machine-grid">
                    ${machinesHtml}
                </div>
            </div>
        `;
    }).join('');

    // 添加事件監聽器
    document.querySelectorAll('.machine-card').forEach(card => {
        card.addEventListener('click', e => {
            // 切換選中狀態
            card.classList.toggle('selected');
            const machineId = card.dataset.machine;
            
            if (card.classList.contains('selected')) {
                selectedMachines.add(machineId);
            } else {
                selectedMachines.delete(machineId);
            }
        });
    });
}

// 生成補貨建議
async function generateReplenishmentSuggestion() {
    if (selectedWarehouses.size === 0) {
        alert('請至少選擇一個倉庫');
        return;
    }
    if (selectedMachines.size === 0) {
        alert('請至少選擇一個機台');
        return;
    }

    const selectedStrategyCard = document.querySelector('.strategy-card.selected');
    if (!selectedStrategyCard) {
        alert('請選擇一個補貨策略');
        return;
    }
    const selectedStrategy = selectedStrategyCard.dataset.strategy;

    try {
        // 為每個選中的機台生成建議
        const suggestions = [];
        for (const machine of selectedMachines) {
            const [store, machineId] = machine.split('-');
            
            const response = await fetch(`/api/warehouse-replenishment-suggestion/${store}-${machineId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    strategy: selectedStrategy,
                    warehouses: Array.from(selectedWarehouses)
                })
            });

            const result = await response.json();
            if (result.success) {
                suggestions.push({
                    machine,
                    ...result
                });
            }
        }

        // 顯示建議結果
        renderSuggestions(suggestions);
    } catch (error) {
        console.error('Error generating replenishment suggestion:', error);
        alert('生成補貨建議時發生錯誤');
    }
}

// 渲染補貨建議結果
function renderSuggestions(suggestions) {
    const resultContainer = document.getElementById('replenishmentResult');
    
    // 按倉庫分類生成出貨清單
    let warehouseShipments = {};
    suggestions.forEach(suggestion => {
        // 對每個建議產品，找出它來自哪個倉庫
        suggestion.suggestion.forEach(item => {
            const adjustment = item.suggestedQty - item.currentQty;
            if (adjustment > 0) {
                // 從倉庫數據中找出該產品所在的倉庫
                const productWarehouses = warehouseData.filter(w => 
                    w.productName === item.productName && 
                    selectedWarehouses.has(w.warehouseName)
                );
                
                if (productWarehouses.length > 0) {
                    // 假設使用第一個有該產品的倉庫
                    const warehouse = productWarehouses[0].warehouseName;
                    if (!warehouseShipments[warehouse]) {
                        warehouseShipments[warehouse] = {};
                    }
                    if (!warehouseShipments[warehouse][item.productName]) {
                        warehouseShipments[warehouse][item.productName] = 0;
                    }
                    warehouseShipments[warehouse][item.productName] += adjustment;
                }
            }
        });
    });

    let resultHTML = '';
    
    // 渲染每個機台的建議
    suggestions.forEach(suggestion => {
        const [store, machineId] = suggestion.machine.split('-');
        
        // 計算總計
        let totals = {
            salesCount: 0,
            currentQty: 0,
            suggestedQty: 0,
            adjustment: 0
        };
        
        const suggestionHTML = `
            <div class="suggestion-card">
                <h4>${store} - ${machineId}</h4>
                ${suggestion.warning ? `<p class="warning">${suggestion.warning}</p>` : ''}
                <div class="suggestion-table-container">
                    <table class="suggestion-table">
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
                            ${suggestion.suggestion
                                // 過濾掉全是0的商品
                                .filter(item => {
                                    const adjustment = item.suggestedQty - item.currentQty;
                                    return item.salesCount30d !== 0 || 
                                           item.currentQty !== 0 || 
                                           item.suggestedQty !== 0 || 
                                           adjustment !== 0;
                                })
                                // 按照30天銷量排序，其次是調整量
                                .sort((a, b) => {
                                    if (a.salesCount30d !== b.salesCount30d) {
                                        return b.salesCount30d - a.salesCount30d;
                                    }
                                    const adjustmentA = a.suggestedQty - a.currentQty;
                                    const adjustmentB = b.suggestedQty - b.currentQty;
                                    return Math.abs(adjustmentB) - Math.abs(adjustmentA);
                                })
                                .map(item => {
                                    const adjustment = item.suggestedQty - item.currentQty;
                                    // 更新總計
                                    totals.salesCount += item.salesCount30d;
                                    totals.currentQty += item.currentQty;
                                    totals.suggestedQty += item.suggestedQty;
                                    totals.adjustment += adjustment;
                                    
                                    return `
                                        <tr>
                                            <td>${item.productName}</td>
                                            <td>${item.salesCount30d}</td>
                                            <td>${item.currentQty}</td>
                                            <td>${item.suggestedQty}</td>
                                            <td class="${adjustment > 0 ? 'positive' : adjustment < 0 ? 'negative' : ''}">${
                                                adjustment > 0 ? '+' + adjustment : adjustment
                                            }</td>
                                        </tr>
                                    `;
                                }).join('')}
                            <tr class="total-row">
                                <td>總計</td>
                                <td>${totals.salesCount}</td>
                                <td>${totals.currentQty}</td>
                                <td>${totals.suggestedQty}</td>
                                <td class="${totals.adjustment > 0 ? 'positive' : totals.adjustment < 0 ? 'negative' : ''}">${
                                    totals.adjustment > 0 ? '+' + totals.adjustment : totals.adjustment
                                }</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        resultHTML += suggestionHTML;
    });

    // 顯示每個倉庫的出貨清單
    const shipmentCards = Object.entries(warehouseShipments).map(([warehouse, shipments]) => {
        if (Object.keys(shipments).length === 0) return '';
        
        // 計算送貨地點
        const deliveryLocations = suggestions.map(s => s.machine).join('、');
        
        return `
            <div class="shipment-card">
                <h4>${warehouse} 出貨清單</h4>
                <p class="delivery-info">送貨地點：${deliveryLocations}</p>
                <div class="suggestion-table-container">
                    <table class="suggestion-table">
                        <thead>
                            <tr>
                                <th>產品名稱</th>
                                <th>出貨數量</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(shipments).map(([product, quantity]) => `
                                <tr>
                                    <td>${product}</td>
                                    <td class="positive">+${quantity}</td>
                                </tr>
                            `).join('')}
                            <tr class="total-row">
                                <td>總計</td>
                                <td class="positive">+${Object.values(shipments).reduce((a, b) => a + b, 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');
        
    // 如果有出貨清單，添加到結果HTML的開頭
    if (shipmentCards) {
        resultHTML = shipmentCards + resultHTML;
    }

    // 添加生成補貨單按鈕
    resultHTML += `
        <div class="action-buttons">
            <button id="generateFormButton" class="btn btn-primary">
                <i class="fas fa-file-excel"></i> 生成補貨單
            </button>
        </div>
    `;

    resultContainer.innerHTML = resultHTML;

    // 添加生成補貨單事件監聽器
    document.getElementById('generateFormButton').addEventListener('click', async () => {
        try {
            // 生成補貨單
            const response = await fetch('/api/generate-replenishment-form', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    suggestions: suggestions
                })
            });

            const result = await response.json();
            if (result.success) {
                // 創建下載鏈接
                window.location.href = `/download-replenishment-form/${result.filename}`;
            } else {
                alert('生成補貨單失敗：' + result.message);
            }
        } catch (error) {
            console.error('Error generating replenishment form:', error);
            alert('生成補貨單時發生錯誤');
        }
    });
}

// 當頁面加載完成時初始化
document.addEventListener('DOMContentLoaded', () => {
    // 監聽標籤切換
    document.querySelectorAll('.tab-link').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const selectedTab = e.target.dataset.tab;
            // 移除所有標籤的active類
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.querySelectorAll('.tab-link').forEach(link => {
                link.classList.remove('active');
            });

            // 添加active類到選中的標籤
            document.getElementById(selectedTab).classList.add('active');
            e.target.classList.add('active');

            // 如果是補貨分頁，初始化它
            if (selectedTab === 'replenishment-tab') {
                console.log('Initializing replenishment tab...');
                initReplenishmentTab();
            }
        });
    });

    // 檢查URL是否指向補貨分頁
    const hash = window.location.hash.slice(1);
    if (hash === 'replenishment') {
        const replenishmentTab = document.querySelector('[data-tab="replenishment-tab"]');
        if (replenishmentTab) {
            replenishmentTab.click();
        }
    }
});
