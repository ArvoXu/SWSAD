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
    
    // 獲取唯一的倉庫名稱
    const uniqueWarehouses = [...new Set(warehouseData.map(w => w.warehouseName))];
    
    warehouseList.innerHTML = uniqueWarehouses.map(warehouse => `
        <div class="warehouse-item">
            <label class="checkbox-container">
                <input type="checkbox" class="warehouse-checkbox" value="${warehouse}">
                <span class="checkmark"></span>
                ${warehouse}
            </label>
            <span class="product-count">
                ${warehouseData.filter(w => w.warehouseName === warehouse).length} 個產品
            </span>
        </div>
    `).join('');

    // 添加事件監聽器
    document.querySelectorAll('.warehouse-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', e => {
            if (e.target.checked) {
                selectedWarehouses.add(e.target.value);
            } else {
                selectedWarehouses.delete(e.target.value);
            }
        });
    });
}

// 渲染機台列表
function renderMachineList() {
    const machineList = document.getElementById('machineList');
    
    // 獲取唯一的機台
    const uniqueMachines = [...new Set(inventoryData.map(item => `${item.store}-${item.machineId}`))];
    
    machineList.innerHTML = uniqueMachines.map(machine => {
        const [store, machineId] = machine.split('-');
        const productCount = inventoryData.filter(item => 
            item.store === store && item.machineId === machineId
        ).length;

        return `
            <div class="machine-item">
                <label class="checkbox-container">
                    <input type="checkbox" class="machine-checkbox" value="${machine}">
                    <span class="checkmark"></span>
                    ${store} - ${machineId}
                </label>
                <span class="product-count">
                    ${productCount} 個產品
                </span>
            </div>
        `;
    }).join('');

    // 添加事件監聽器
    document.querySelectorAll('.machine-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', e => {
            if (e.target.checked) {
                selectedMachines.add(e.target.value);
            } else {
                selectedMachines.delete(e.target.value);
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

    const selectedStrategy = document.querySelector('input[name="replenishStrategy"]:checked').value;

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
    
    // 生成合併的出貨清單
    let consolidatedShipment = {};
    suggestions.forEach(suggestion => {
        suggestion.suggestion.forEach(item => {
            const adjustment = item.suggestedQty - item.currentQty;
            if (adjustment > 0) {
                if (consolidatedShipment[item.productName]) {
                    consolidatedShipment[item.productName] += adjustment;
                } else {
                    consolidatedShipment[item.productName] = adjustment;
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
                            ${suggestion.suggestion.map(item => {
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

    // 如果有需要補貨的商品，顯示出貨清單
    if (Object.keys(consolidatedShipment).length > 0) {
        const shipmentHTML = `
            <div class="shipment-card">
                <h4>合併出貨清單</h4>
                <div class="suggestion-table-container">
                    <table class="suggestion-table">
                        <thead>
                            <tr>
                                <th>產品名稱</th>
                                <th>出貨數量</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(consolidatedShipment).map(([product, quantity]) => `
                                <tr>
                                    <td>${product}</td>
                                    <td class="positive">+${quantity}</td>
                                </tr>
                            `).join('')}
                            <tr class="total-row">
                                <td>總計</td>
                                <td class="positive">+${Object.values(consolidatedShipment).reduce((a, b) => a + b, 0)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        resultHTML = shipmentHTML + resultHTML;
    }

    resultContainer.innerHTML = resultHTML;
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
