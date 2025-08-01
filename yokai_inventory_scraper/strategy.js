// 在 document ready 後添加這段代碼
document.addEventListener('DOMContentLoaded', () => {
    // 為策略卡片添加事件監聽
    document.querySelectorAll('.strategy-card').forEach(card => {
        card.addEventListener('click', e => {
            // 移除其他卡片的選中狀態
            document.querySelectorAll('.strategy-card').forEach(c => 
                c.classList.remove('selected')
            );
            // 選中當前卡片
            card.classList.add('selected');
            // 更新隱藏的radio input
            const strategy = card.dataset.strategy;
            document.querySelector(`input[name="replenishStrategy"][value="${strategy}"]`).checked = true;
        });
    });

    // 初始化時選中預設策略
    const defaultStrategy = document.querySelector('.strategy-card[data-strategy="stable"]');
    if (defaultStrategy) {
        defaultStrategy.classList.add('selected');
    }
});
