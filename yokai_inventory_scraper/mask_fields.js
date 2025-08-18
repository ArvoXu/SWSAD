// Simple masking utility - deterministic during session
(function(window){
    // Maps per type: e.g., product -> { '真品名': 'Product-1' }
    const maps = {
        product: {},
        store: {},
        warehouse: {},
        machine: {},
        payType: {},
        address: {},
        note: {}
    };

    const counters = {
        product: 0,
        store: 0,
        warehouse: 0,
        machine: 0,
        payType: 0,
        address: 0,
        note: 0
    };

    function getOrCreate(type, original) {
        if (!original && original !== 0) return '';
        const key = String(original);
        if (maps[type][key]) return maps[type][key];
        counters[type] += 1;
        const label = `${labelFor(type)}-${counters[type]}`;
        maps[type][key] = label;
        return label;
    }

    function labelFor(type) {
        switch(type) {
            case 'product': return 'Product';
            case 'store': return 'Store';
            case 'warehouse': return 'Warehouse';
            case 'machine': return 'Machine';
            case 'payType': return 'PayType';
            case 'address': return 'Address';
            case 'note': return 'Note';
            default: return 'X';
        }
    }

    // Public API: create masked copy of a data item for display only.
    function maskInventoryItemForDisplay(item) {
        // Do NOT mutate the original object (presentation.js relies on originals for logic)
        const copy = Object.assign({}, item);

        if ('productName' in copy) copy.productName = getOrCreate('product', copy.productName);
        if ('store' in copy) copy.store = getOrCreate('store', copy.store);
        if ('warehouseName' in copy) copy.warehouseName = getOrCreate('warehouse', copy.warehouseName);
        if ('machineId' in copy) copy.machineId = getOrCreate('machine', copy.machineId);
        if ('address' in copy) copy.address = getOrCreate('address', copy.address);
        if ('note' in copy) copy.note = getOrCreate('note', copy.note);

        return copy;
    }

    // Mask a storeKey like "Store-Machine" for display, but keep machine part masked consistently
    function maskStoreKeyForDisplay(storeKey) {
        if (!storeKey) return '';
        const parts = String(storeKey).split('-');
        if (parts.length === 1) return getOrCreate('store', storeKey);
        const machine = parts.pop();
        const store = parts.join('-');
        const maskedStore = getOrCreate('store', store);
        const maskedMachine = getOrCreate('machine', machine);
        return `${maskedStore}-${maskedMachine}`;
    }

    function maskTransactionForDisplay(tx) {
        const copy = Object.assign({}, tx);
        if ('shopName' in copy) copy.shopName = getOrCreate('store', copy.shopName);
        if ('product' in copy) copy.product = getOrCreate('product', copy.product);
        if ('payType' in copy) copy.payType = getOrCreate('payType', copy.payType);
        return copy;
    }

    // Expose minimal API
    window.__maskFields = {
    getOrCreate,
        maskInventoryItemForDisplay,
        maskStoreKeyForDisplay,
        maskTransactionForDisplay,
        // For debugging/inspection
        _internal: { maps, counters }
    };

})(window || this);
