(function () {
    const DB_NAME = 'cricket-score-journal';
    const STORE_NAME = 'matches';
    const DB_VERSION = 1;
    let databasePromise;

    function openDatabase() {
        if (!('indexedDB' in window)) {
            return Promise.reject(new Error('indexeddb_unavailable'));
        }
        if (databasePromise) return databasePromise;

        databasePromise = new Promise((resolve, reject) => {
            const request = window.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'matchId' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
            request.onblocked = () => reject(new Error('indexeddb_upgrade_blocked'));
        });
        return databasePromise;
    }

    async function load(matchId) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const request = transaction.objectStore(STORE_NAME).get(String(matchId));
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('indexeddb_read_failed'));
            transaction.onabort = () => reject(transaction.error || new Error('indexeddb_read_aborted'));
        });
    }

    async function save(record) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            transaction.objectStore(STORE_NAME).put(record);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('indexeddb_write_failed'));
            transaction.onabort = () => reject(transaction.error || new Error('indexeddb_write_aborted'));
        });
    }

    window.ScoreStorage = { load, save };
})();
