# 補貨 SOP（RestockSOP）專案說明

## 概述
**補貨 SOP 專案** 為外包的補貨人員提供一套簡潔、可操作的工作輔助系統。目標是讓補貨人員即便在尚未熟悉細節的情況下，也能依循步驟完成任務、不遺漏任何關鍵環節；同時蒐集「評分與評語」以量化人員需求與流程痛點。系統內的正向鼓勵與激勵文案靈感來自 **多鄰國（Duolingo）** 的簡潔鼓勵語與成就機制。

---

## 核心價值與目的 ✅
- 降低補貨新手上手門檻，確保流程一致性
- 收集結構化反饋，用於持續改進 SOP
- 以正向鼓勵提升外包人員士氣與遵循率
- 量化績效（評分、完成率、平均處理時間）以支援決策

---

## 主要功能
1. 步驟式任務指引（Checklist）
   - 每個補貨任務拆分為明確步驟（例如：到貨檢查 → 上架 → 標記缺貨 → 備註）
   - 支援逐步打勾與回退

2. 即時回饋與評分
   - 人員提交任務後可給予 1–5 星評分與短評
   - 支援複數預設標籤（例如：耗時、缺料、盤點差異）

3. 正向鼓勵與徽章系統（Gamification）
   - 完成任務後顯示友善鼓勵語（短句，靈感來自 Duolingo）
   - 累積徽章或連續完成（streak）以提高動機

4. 上傳與證據收集
   - 可拍照上傳（商品、貨架/問題狀況）
   - 自動附帶位置/時間戳記（若允許）

5. 管理端報表與統計
   - 平均評分、任務完成率、常見標籤、處理耗時分布
   - 可匯出 CSV/Excel，供運營團隊優化 SOP

6. 離線緩存與同步（建議）
   - 支援網絡不穩定時本地緩存，恢復網路後自動上傳

---

## 使用者流程（簡要）
1. 補貨員登入（或掃 QR / 臨時身份）
2. 選擇今日任務或按門店顯示任務列表
3. 依步驟完成任務並打勾
4. 拍照（如有）與填寫必要備註
5. 提交評分（1–5 星）與短評/標籤
6. 顯示鼓勵訊息與可能的建議

---

## 前端技術（目前 repo）⚙️
- 檔案位置：`restockSOP/index.html`、`restockSOP/app.js`、`restockSOP/restockSOP.css`
- 技術：Vanilla JS + HTML + CSS（輕量、易於離線化與行動設備優化）

---

## 後端建議（整合到現有 server）🔧
- 新增路由：
  - `GET /restock-sop` → 回傳前端介面
  - `POST /api/restock-sop/submit` → 提交任務結果（包含評分、標籤、備註、照片 metadata）
  - `GET /api/restock-sop/reports` → 管理端報表（需權限驗證）

- JSON 提交範例：
```json
{
  "task_id": "20251229-storeA-0001",
  "store": "Store A",
  "assignee": "worker_01",
  "steps_completed": ["到貨檢查","上架","清點"],
  "score": 4,
  "tags": ["耗時較長","缺料"],
  "comment": "上架時發現商品 B 少 2 件",
  "photos": ["/uploads/photo_1.jpg"],
  "started_at": "2025-12-29T09:10:00+08:00",
  "submitted_at": "2025-12-29T09:30:00+08:00"
}
```

---

## 資料模型建議（SQLAlchemy 範例）
```python
class RestockTask(Base):
    __tablename__ = 'restock_task'
    id = Column(Integer, primary_key=True)
    task_id = Column(String, unique=True, index=True)
    store = Column(String)
    assignee = Column(String)
    steps_completed = Column(Text)  # JSON encoded list
    score = Column(Integer)  # 1-5
    tags = Column(Text)  # JSON encoded list
    comment = Column(Text)
    photos = Column(Text)  # JSON encoded list of paths
    started_at = Column(DateTime)
    submitted_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

class RestockFeedback(Base):
    __tablename__ = 'restock_feedback'
    id = Column(Integer, primary_key=True)
    task_id = Column(String, ForeignKey('restock_task.task_id'))
    rating = Column(Integer)
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
```

---

## 評分與量化指標 📊
- 平均評分（Avg Score）
- 任務完成率（Completed / Assigned）
- 平均處理時間（submitted_at - started_at）
- 常見標籤分佈（Tag Frequency）
- 反饋中「可改進項」關鍵字雲（NLP 或人工分類）

---

## 鼓勵語與 UX 範例（受 Duolingo 啟發）✨
- 完成任務時：
  - 「太棒了！你完成了補貨任務，今天又進步了一步 🎉」
  - 「讚！連續完成 3 天，獲得『可靠補貨手』徽章 🏅」
- 給予評分後：
  - 高評分（4-5）： 「感謝你的用心！你提交的回饋會被我們珍視 👍」
  - 低評分（1-2）： 「謝謝回報，我們會調查並改進流程；已將你的意見記錄下來。」
- 建議用短句、幽默親切的語氣，字句不宜過長

---

## 改善建議與下一步計畫 🔜
1. 在 `server.py` 新增必要 API 與授權檢查
2. 前端 `app.js` 添加離線儲存與上傳重試機制
3. 加入上傳圖片的檔案大小/格式限制與稽核
4. 建立管理端報表頁面（平均分數、標籤分佈、趨勢圖）
5. 設定自動化測試（提交 API、資料驗證）

---

## 在作品集中的呈現要點 🎯
- 強調「以人為本」的設計：簡潔的操作、正向回饋機制
- 展示如何把定性反饋量化：評分、標籤與數據視覺化
- 說明離線可用性與錯誤容忍（實務性考量）
- 寫出幾條核心 KPI（例如：平均評分提升、問題回報率下降）來說明成效

---

## 範例頁面位置
- 使用者頁面：`restockSOP/index.html`
- 主程式邏輯：`restockSOP/app.js`
- 樣式：`restockSOP/restockSOP.css`

---

## 結語
這個小型專案結合了 SOP 流程化、使用者回饋與簡單的遊戲化元素，非常適合呈現在作品集中，展示你對「流程設計、使用者體驗與數據導向改進」的能力。若要我幫你把這個文件以繁體中文優化成一頁作品集展示、或幫你在 `server.py` 中新增示範路由與資料模型，我可以繼續實作。