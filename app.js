// Prevent a new script from initializing against an old/corrupt document.
(() => {
  const release = 'manual-backup-20261106-1';
  if (document.documentElement.dataset.appRelease !== release || document.documentElement.dataset.appReleaseBlocked === 'true') {
    const message = '页面与程序版本不一致或资源不完整，已暂停初始化。请联网后关闭并重新打开应用；不会自动刷新或清除数据。';
    if (window.shounaReleaseNotice) window.shounaReleaseNotice(message, true);
    else {
      const show = () => {
        const note = document.createElement('p');
        note.setAttribute('role', 'alert');
        note.textContent = message;
        document.body.prepend(note);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, { once: true });
      else show();
      // Legacy HTML has no independent bootstrap. Still allow a safe SW update.
      if ('serviceWorker' in navigator) window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(console.error);
      }, { once: true });
    }
    throw new Error(message);
  }
  document.documentElement.dataset.appCodeRelease = release;
})();

/**
 * Core application logic for Minimal Item Storage PWA
 */

// --- 1. INDEXEDDB MANAGER ---
const DB_NAME = 'ItemStorageDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';

// Backup safety observers; no data or transaction behavior is changed.
let pendingItemWrites = 0;
let pendingPhotoJobs = 0;
function observeItemWrite(transaction) {
  pendingItemWrites++;
  const finished = () => { pendingItemWrites--; };
  transaction.addEventListener('complete', finished, { once: true });
  transaction.addEventListener('abort', finished, { once: true });
}

class DBManager {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (e) => {
        console.error('Database failed to open:', e);
        reject(e);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  async getAll() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('createdAt');
      const request = index.openCursor(null, 'prev'); // Order by createdAt descending (newest first)
      const results = [];

      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = (e) => reject(e);
    });
  }

  async get(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  async add(item) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      observeItemWrite(transaction);
      const store = transaction.objectStore(STORE_NAME);
      
      const cleanItem = {
        name: item.name || '',
        quantity: item.quantity !== null && item.quantity !== undefined ? Number(item.quantity) : null,
        location: item.location || '',
        photoClose: item.photoClose || null,
        photoFar: item.photoFar || null,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      const request = store.add(cleanItem);

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  }

  async update(item) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      observeItemWrite(transaction);
      const store = transaction.objectStore(STORE_NAME);
      
      const cleanItem = {
        id: Number(item.id),
        name: item.name || '',
        quantity: item.quantity !== null && item.quantity !== undefined && item.quantity !== '' ? Number(item.quantity) : null,
        location: item.location || '',
        photoClose: item.photoClose || null,
        photoFar: item.photoFar || null,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.now()
      };

      const request = store.put(cleanItem);

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }

  async delete(id) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('Database not initialized');
      const transaction = this.db.transaction(STORE_NAME, 'readwrite');
      observeItemWrite(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(Number(id));

      request.onsuccess = () => resolve();
      request.onerror = (e) => reject(e);
    });
  }
}

const db = new DBManager();


// --- 2. IMAGE COMPRESSION UTILITY ---
/**
 * Automatically compresses an image file to standard sizes for storage.
 * Max dimension: 1280px, JPEG Format, Quality: 0.8
 */
async function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.8) {
  pendingPhotoJobs++;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Maintain Aspect Ratio
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to highly optimized JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  }).finally(() => { pendingPhotoJobs--; });
}


// --- 3. TOAST NOTIFICATION UTILITY ---
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}


// --- 4. STATE AND VARIABLES ---
let allItems = []; // Full stock from DB
let filteredItems = []; // Items filtered by search

// Continuous add session variables
let sessionItems = []; // List of item drafts in current session
let sessionIndex = 0; // Current index in the active session
let inheritedLocation = ''; // Location inherited as placeholder

// Viewing / Editing variables
let activeViewItem = null;


// --- 5. OFFLINE REGISTRATION ---
// Registered independently in index.html so failed resource checks cannot block updates.


// --- 6. DOM ELEMENTS ---
// Main screen
const btnAddTrigger = document.getElementById('btn-add-trigger');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');
const stockListContainer = document.getElementById('stock-list');
const emptyStateContainer = document.getElementById('empty-state');

// Continuous Add Modal Elements
const addModal = document.getElementById('add-modal');
const btnSessionPrev = document.getElementById('btn-session-prev');
const btnSessionNext = document.getElementById('btn-session-next');
const btnSessionDone = document.getElementById('btn-session-done');
const sessionIndicator = document.getElementById('session-indicator');

const formAdd = document.getElementById('add-item-form');
const inputName = document.getElementById('input-name');
const inputQty = document.getElementById('input-qty');
const inputLocation = document.getElementById('input-location');

const fileClose = document.getElementById('file-close');
const fileFar = document.getElementById('file-far');
const prevClose = document.getElementById('prev-close');
const prevFar = document.getElementById('prev-far');
const uploaderClose = document.getElementById('uploader-close');
const uploaderFar = document.getElementById('uploader-far');
const innerClose = document.getElementById('inner-close');
const innerFar = document.getElementById('inner-far');
const btnRemoveClose = document.getElementById('btn-remove-close');
const btnRemoveFar = document.getElementById('btn-remove-far');

// Detail Modal Elements
const detailModal = document.getElementById('detail-modal');
const btnDetailClose = document.getElementById('btn-detail-close');
const btnDetailEdit = document.getElementById('btn-detail-edit');
const btnDetailDelete = document.getElementById('btn-detail-delete');
const detailImgClose = document.getElementById('detail-img-close');
const detailImgFar = document.getElementById('detail-img-far');
const detailImgClosePlaceholder = document.getElementById('detail-img-close-placeholder');
const detailImgFarPlaceholder = document.getElementById('detail-img-far-placeholder');
const detailValName = document.getElementById('detail-val-name');
const detailValQty = document.getElementById('detail-val-qty');
const detailValLocation = document.getElementById('detail-val-location');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const btnEditCancel = document.getElementById('btn-edit-cancel');
const btnEditSave = document.getElementById('btn-edit-save');
const btnEditDelete = document.getElementById('btn-edit-delete');

const formEdit = document.getElementById('edit-item-form');
const editInputName = document.getElementById('edit-input-name');
const editInputQty = document.getElementById('edit-input-qty');
const editInputLocation = document.getElementById('edit-input-location');

const editFileClose = document.getElementById('edit-file-close');
const editFileFar = document.getElementById('edit-file-far');
const editPrevClose = document.getElementById('edit-prev-close');
const editPrevFar = document.getElementById('edit-prev-far');
const editUploaderClose = document.getElementById('edit-uploader-close');
const editUploaderFar = document.getElementById('edit-uploader-far');
const editInnerClose = document.getElementById('edit-inner-close');
const editInnerFar = document.getElementById('edit-inner-far');
const editBtnRemoveClose = document.getElementById('edit-btn-remove-close');
const editBtnRemoveFar = document.getElementById('edit-btn-remove-far');


// --- 7. CORE APP ACTIONS ---

/**
 * Loads all items from database and renders them.
 */
async function loadInventory() {
  try {
    allItems = await db.getAll();
    filterAndRender();
  } catch (err) {
    console.error('Failed to load inventory:', err);
    showToast('无法读取本地存储');
  }
}

/**
 * Performs search filtering and renders the stock grid.
 */
function filterAndRender() {
  const query = searchInput.value.trim();
  
  // Show / hide clear search button
  if (query !== '') {
    clearSearchBtn.style.display = 'block';
  } else {
    clearSearchBtn.style.display = 'none';
  }

  // Filter using ItemSearch from search.js
  filteredItems = window.ItemSearch.filter(allItems, query);

  renderStockGrid(filteredItems);
}

/**
 * Renders the given list of items into the stock grid.
 */
function renderStockGrid(items) {
  stockListContainer.innerHTML = '';
  
  if (items.length === 0) {
    emptyStateContainer.style.display = 'flex';
    stockListContainer.style.display = 'none';
    return;
  }

  emptyStateContainer.style.display = 'none';
  stockListContainer.style.display = 'grid';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'stock-card';
    card.dataset.id = item.id;

    // Determine the cover photo (prefer Close shot details, fallback to Far shot)
    const coverPhoto = item.photoClose || item.photoFar;
    
    let imgHTML = '';
    if (coverPhoto) {
      imgHTML = `<img class="card-img" src="${coverPhoto}" alt="${item.name || '物品'}">`;
    } else {
      imgHTML = `
        <div class="card-placeholder">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>暂无图片</span>
        </div>
      `;
    }

    const qtyDisplay = item.quantity !== null && item.quantity !== undefined ? `×${item.quantity}` : '';
    const locDisplay = item.location || '无位置';

    card.innerHTML = `
      <div class="card-img-wrapper">
        ${imgHTML}
      </div>
      <div class="card-info">
        <div class="card-name">${item.name || '未命名物品'}</div>
        <div class="card-meta">
          <span class="card-location" title="${locDisplay}">${locDisplay}</span>
          <span class="card-qty">${qtyDisplay}</span>
        </div>
      </div>
    `;

    // Click handler to open detail modal
    card.addEventListener('click', () => {
      openDetailModal(item);
    });

    stockListContainer.appendChild(card);
  });
}


// --- 8. MODAL HELPERS ---

function openModal(modal) {
  modal.classList.add('active');
  document.body.style.overflow = 'hidden'; // Stop background scrolling
}

function closeModal(modal) {
  modal.classList.remove('active');
  document.body.style.overflow = ''; // Restore scrolling
}

// Global modal overlay click outside handler
document.querySelectorAll('.modal-overlay').forEach(modal => {
  modal.addEventListener('click', (e) => {
    // Check if the user clicked the backdrop directly
    if (e.target === modal && modal.dataset.closeOnClickOutside === "true") {
      if (modal.id === 'add-modal') {
        handleSessionDone(); // Save and complete the session on click outside
      } else {
        closeModal(modal);
      }
    }
  });
});


// --- 9. CONTINUOUS ADD SESSION STATE MANAGER ---

function startNewAddSession() {
  // Reset session
  sessionItems = [];
  sessionIndex = 0;
  inheritedLocation = '';
  
  // Create first blank draft
  const initialItem = createBlankSessionItem();
  sessionItems.push(initialItem);
  
  loadSessionForm(0);
  openModal(addModal);
}

function createBlankSessionItem() {
  return {
    name: '',
    quantity: '',
    location: '',
    photoClose: null,
    photoFar: null,
    dbId: null // If saved to IndexedDB, stores the real record ID
  };
}

/**
 * Loads a session draft item into the form fields.
 */
function loadSessionForm(idx) {
  sessionIndex = idx;
  const item = sessionItems[idx];

  // Fill text inputs
  inputName.value = item.name;
  inputQty.value = item.quantity;
  inputLocation.value = item.location;

  // Set up inherited Location Placeholder
  setupLocationPlaceholder();

  // Photo close shot rendering
  if (item.photoClose) {
    prevClose.src = item.photoClose;
    prevClose.style.display = 'block';
    btnRemoveClose.style.display = 'flex';
    innerClose.style.style = 'none';
    innerClose.style.opacity = '0';
  } else {
    prevClose.src = '';
    prevClose.style.display = 'none';
    btnRemoveClose.style.display = 'none';
    innerClose.style.style = '';
    innerClose.style.opacity = '1';
  }

  // Photo far shot rendering
  if (item.photoFar) {
    prevFar.src = item.photoFar;
    prevFar.style.display = 'block';
    btnRemoveFar.style.display = 'flex';
    innerFar.style.style = 'none';
    innerFar.style.opacity = '0';
  } else {
    prevFar.src = '';
    prevFar.style.display = 'none';
    btnRemoveFar.style.display = 'none';
    innerFar.style.style = '';
    innerFar.style.opacity = '1';
  }

  // Update Indicator Header: "1/5" etc.
  sessionIndicator.innerText = `${idx + 1}/${sessionItems.length}`;

  // Disable/Enable Previous button
  if (idx === 0) {
    btnSessionPrev.disabled = true;
    btnSessionPrev.style.opacity = '0.5';
  } else {
    btnSessionPrev.disabled = false;
    btnSessionPrev.style.opacity = '1';
  }
}

/**
 * Calculates and displays location placeholder inherited from the previous item.
 */
function setupLocationPlaceholder() {
  // By default, reset placeholder
  inputLocation.placeholder = '例如：客厅电视柜左抽屉';
  inheritedLocation = '';

  // Placeholder is only active on a NEW record (the last index in sessionItems list)
  // and only when there is a previous record in the sequence
  if (sessionIndex > 0 && sessionIndex === sessionItems.length - 1) {
    const prevItem = sessionItems[sessionIndex - 1];
    
    // Check if the previous item was a text entry (non-pure photo)
    const hasText = (prevItem.name && prevItem.name.trim() !== '') || 
                    (prevItem.location && prevItem.location.trim() !== '');
    
    if (hasText && prevItem.location && prevItem.location.trim() !== '') {
      inheritedLocation = prevItem.location.trim();
      inputLocation.placeholder = `继承上条位置：${inheritedLocation}`;
    }
  }
}

/**
 * Reads form data, handles placeholder inheritance, and saves the draft state in memory.
 */
function saveFormToSessionDraft() {
  const item = sessionItems[sessionIndex];
  
  item.name = inputName.value.trim();
  item.quantity = inputQty.value !== '' ? Number(inputQty.value) : '';
  
  // Handle location placeholder inheritance:
  const rawLoc = inputLocation.value.trim();
  if (rawLoc === '' && inheritedLocation !== '') {
    // User left empty but we have an inherited placeholder -> save the placeholder as actual value
    item.location = inheritedLocation;
  } else {
    item.location = rawLoc;
  }

  // Read preview source directly as Base64 strings (already optimized during upload)
  item.photoClose = prevClose.style.display !== 'none' ? prevClose.src : null;
  item.photoFar = prevFar.style.display !== 'none' ? prevFar.src : null;
}

/**
 * Checks if a session item has any actual content to save.
 */
function isItemEmpty(item) {
  return !(
    (item.name && item.name.trim() !== '') ||
    (item.location && item.location.trim() !== '') ||
    item.quantity !== '' ||
    item.photoClose ||
    item.photoFar
  );
}

/**
 * Commits a single session item to IndexedDB (adds new or updates existing).
 */
async function commitSessionItemToDB(idx) {
  const item = sessionItems[idx];
  
  if (isItemEmpty(item)) {
    // Skip empty record saving
    return null;
  }

  try {
    if (item.dbId) {
      // Already saved previously in this session -> Update it
      const record = {
        id: item.dbId,
        name: item.name,
        quantity: item.quantity,
        location: item.location,
        photoClose: item.photoClose,
        photoFar: item.photoFar
      };
      await db.update(record);
      return item.dbId;
    } else {
      // New record -> Add it
      const newId = await db.add(item);
      item.dbId = newId; // Cache the database ID
      return newId;
    }
  } catch (err) {
    console.error('Failed to commit session item to DB:', err);
    showToast('本地存储写入失败');
    return null;
  }
}

/**
 * Handles going to the Previous item in session.
 */
async function handleSessionPrev() {
  if (sessionIndex === 0) return;
  
  // Save current item draft first
  saveFormToSessionDraft();
  await commitSessionItemToDB(sessionIndex);

  // Move back
  loadSessionForm(sessionIndex - 1);
}

/**
 * Handles going to the Next item in session.
 * Automatically saves the current record, and opens a new blank record.
 */
async function handleSessionNext() {
  // Save current item draft first
  saveFormToSessionDraft();
  
  const savedId = await commitSessionItemToDB(sessionIndex);

  // If we are at the end of the current session sequence, create a new blank draft
  if (sessionIndex === sessionItems.length - 1) {
    // Only proceed if current item was not completely empty, or if we successfully saved it
    if (isItemEmpty(sessionItems[sessionIndex])) {
      showToast('当前记录为空，无需保存');
      return;
    }
    
    // Add new blank item draft
    const newItem = createBlankSessionItem();
    sessionItems.push(newItem);
  }

  // Load next form in sequence
  loadSessionForm(sessionIndex + 1);
  loadInventory(); // Refresh list in background
}

/**
 * Saves current item and ends the session.
 */
async function handleSessionDone() {
  saveFormToSessionDraft();
  await commitSessionItemToDB(sessionIndex);
  
  closeModal(addModal);
  loadInventory(); // Refresh main list
  showToast('收纳记录已保存');
}


// --- 10. DETAIL MODAL LOGIC ---

function openDetailModal(item) {
  activeViewItem = item;

  detailValName.innerText = item.name || '未命名物品';
  detailValQty.innerText = item.quantity !== null && item.quantity !== undefined ? item.quantity : '未填写';
  detailValLocation.innerText = item.location || '未填写';

  // Render close shot view
  if (item.photoClose) {
    detailImgClose.src = item.photoClose;
    detailImgClose.style.display = 'block';
    detailImgClosePlaceholder.style.display = 'none';
  } else {
    detailImgClose.src = '';
    detailImgClose.style.display = 'none';
    detailImgClosePlaceholder.style.display = 'flex';
  }

  // Render far shot view
  if (item.photoFar) {
    detailImgFar.src = item.photoFar;
    detailImgFar.style.display = 'block';
    detailImgFarPlaceholder.style.display = 'none';
  } else {
    detailImgFar.src = '';
    detailImgFar.style.display = 'none';
    detailImgFarPlaceholder.style.display = 'flex';
  }

  openModal(detailModal);
}


// --- 11. EDIT MODAL LOGIC (PHASE 3) ---

function openEditModalFromDetail() {
  if (!activeViewItem) return;
  
  // Close detail view first
  closeModal(detailModal);

  // Load fields into edit form
  editInputName.value = activeViewItem.name || '';
  editInputQty.value = activeViewItem.quantity !== null && activeViewItem.quantity !== undefined ? activeViewItem.quantity : '';
  editInputLocation.value = activeViewItem.location || '';

  // Close shot photo state
  if (activeViewItem.photoClose) {
    editPrevClose.src = activeViewItem.photoClose;
    editPrevClose.style.display = 'block';
    editBtnRemoveClose.style.display = 'flex';
    editInnerClose.style.opacity = '0';
  } else {
    editPrevClose.src = '';
    editPrevClose.style.display = 'none';
    editBtnRemoveClose.style.display = 'none';
    editInnerClose.style.opacity = '1';
  }

  // Far shot photo state
  if (activeViewItem.photoFar) {
    editPrevFar.src = activeViewItem.photoFar;
    editPrevFar.style.display = 'block';
    editBtnRemoveFar.style.display = 'flex';
    editInnerFar.style.opacity = '0';
  } else {
    editPrevFar.src = '';
    editPrevFar.style.display = 'none';
    editBtnRemoveFar.style.display = 'none';
    editInnerFar.style.opacity = '1';
  }

  openModal(editModal);
}

async function handleEditSave() {
  if (!activeViewItem) return;

  const updatedItem = {
    ...activeViewItem,
    name: editInputName.value.trim(),
    quantity: editInputQty.value !== '' ? Number(editInputQty.value) : null,
    location: editInputLocation.value.trim(),
    photoClose: editPrevClose.style.display !== 'none' ? editPrevClose.src : null,
    photoFar: editPrevFar.style.display !== 'none' ? editPrevFar.src : null
  };

  try {
    await db.update(updatedItem);
    closeModal(editModal);
    loadInventory();
    showToast('修改成功');
  } catch (err) {
    console.error('Failed to update item:', err);
    showToast('保存修改失败');
  }
}

async function handleEditDelete() {
  if (!activeViewItem) return;

  const confirmed = confirm(`确定要彻底删除“${activeViewItem.name || '该物品'}”吗？`);
  if (!confirmed) return;

  try {
    await db.delete(activeViewItem.id);
    closeModal(editModal);
    loadInventory();
    showToast('物品已删除');
  } catch (err) {
    console.error('Failed to delete item:', err);
    showToast('删除失败');
  }
}

async function handleDetailDelete() {
  if (!activeViewItem) return;

  const confirmed = confirm(`确定要彻底删除“${activeViewItem.name || '该物品'}”吗？`);
  if (!confirmed) return;

  try {
    await db.delete(activeViewItem.id);
    closeModal(detailModal);
    loadInventory();
    showToast('物品已删除');
  } catch (err) {
    console.error('Failed to delete item:', err);
    showToast('删除失败');
  }
}


// --- 12. EVENT LISTENERS SETUP ---

// Trigger new continuous add sequence
btnAddTrigger.addEventListener('click', startNewAddSession);

// Continuous add navigation
btnSessionPrev.addEventListener('click', handleSessionPrev);
btnSessionNext.addEventListener('click', handleSessionNext);
btnSessionDone.addEventListener('click', handleSessionDone);

// Search events
searchInput.addEventListener('input', filterAndRender);
clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  filterAndRender();
  searchInput.focus();
});

// Photo upload listeners (Add Modal)
uploaderClose.addEventListener('click', () => fileClose.click());
uploaderFar.addEventListener('click', () => fileFar.click());

fileClose.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    try {
      showToast('压缩并导入近景照...');
      const optimizedDataUrl = await compressImage(e.target.files[0]);
      prevClose.src = optimizedDataUrl;
      prevClose.style.display = 'block';
      btnRemoveClose.style.display = 'flex';
      innerClose.style.opacity = '0';
    } catch (err) {
      console.error(err);
      showToast('图片加载失败');
    }
  }
});

fileFar.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    try {
      showToast('压缩并导入远景照...');
      const optimizedDataUrl = await compressImage(e.target.files[0]);
      prevFar.src = optimizedDataUrl;
      prevFar.style.display = 'block';
      btnRemoveFar.style.display = 'flex';
      innerFar.style.opacity = '0';
    } catch (err) {
      console.error(err);
      showToast('图片加载失败');
    }
  }
});

btnRemoveClose.addEventListener('click', (e) => {
  e.stopPropagation(); // Avoid triggering file selection
  fileClose.value = '';
  prevClose.src = '';
  prevClose.style.display = 'none';
  btnRemoveClose.style.display = 'none';
  innerClose.style.opacity = '1';
});

btnRemoveFar.addEventListener('click', (e) => {
  e.stopPropagation(); // Avoid triggering file selection
  fileFar.value = '';
  prevFar.src = '';
  prevFar.style.display = 'none';
  btnRemoveFar.style.display = 'none';
  innerFar.style.opacity = '1';
});

// Detail Modal Events
btnDetailClose.addEventListener('click', () => closeModal(detailModal));
btnDetailEdit.addEventListener('click', openEditModalFromDetail);
btnDetailDelete.addEventListener('click', handleDetailDelete);

// Edit Modal Events (Phase 3)
btnEditCancel.addEventListener('click', () => {
  closeModal(editModal);
  // Re-open detail view for reference
  openDetailModal(activeViewItem);
});
btnEditSave.addEventListener('click', handleEditSave);
btnEditDelete.addEventListener('click', handleEditDelete);

editUploaderClose.addEventListener('click', () => editFileClose.click());
editUploaderFar.addEventListener('click', () => editFileFar.click());

editFileClose.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    try {
      showToast('压缩图片中...');
      const optimizedDataUrl = await compressImage(e.target.files[0]);
      editPrevClose.src = optimizedDataUrl;
      editPrevClose.style.display = 'block';
      editBtnRemoveClose.style.display = 'flex';
      editInnerClose.style.opacity = '0';
    } catch (err) {
      console.error(err);
      showToast('图片加载失败');
    }
  }
});

editFileFar.addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    try {
      showToast('压缩图片中...');
      const optimizedDataUrl = await compressImage(e.target.files[0]);
      editPrevFar.src = optimizedDataUrl;
      editPrevFar.style.display = 'block';
      editBtnRemoveFar.style.display = 'flex';
      editInnerFar.style.opacity = '0';
    } catch (err) {
      console.error(err);
      showToast('图片加载失败');
    }
  }
});

editBtnRemoveClose.addEventListener('click', (e) => {
  e.stopPropagation();
  editFileClose.value = '';
  editPrevClose.src = '';
  editPrevClose.style.display = 'none';
  editBtnRemoveClose.style.display = 'none';
  editInnerClose.style.opacity = '1';
});

editBtnRemoveFar.addEventListener('click', (e) => {
  e.stopPropagation();
  editFileFar.value = '';
  editPrevFar.src = '';
  editPrevFar.style.display = 'none';
  editBtnRemoveFar.style.display = 'none';
  editInnerFar.style.opacity = '1';
});


// --- 13. APP INITIALIZATION ---
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await db.init();
    await loadInventory();
    console.log('App initialized successfully.');
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('初始化数据库失败');
  }
});

// --- 14. MANUAL BACKUP EXPORT (format v1; no import/write operations) ---
(() => {
  'use strict';
  const APP_ID = 'item-storage-assistant';
  const FORMAT_VERSION = 1;
  const ALGORITHM = 'SHA-256/canonical-json-v1';
  // Canonical v1: JSON primitives; recursively sorted object keys; array order retained.
  // Hash each canonical item; hash canonical {metadata, recordHashes} for the manifest.
  const FIELDS = ['id', 'name', 'quantity', 'location', 'photoClose', 'photoFar', 'createdAt', 'updatedAt'];
  const el = id => document.getElementById(id);
  const modal = el('backup-modal');
  const status = el('backup-status');
  const family = el('backup-family');
  const fileInput = el('backup-file');
  const generate = el('btn-backup-generate');
  const share = el('btn-backup-share');
  const download = el('btn-backup-download');
  const verify = el('btn-backup-verify');
  const close = el('btn-backup-close');
  let busy = false;
  let generatedFile = null;
  let downloadURL = null;
  let lastFocus = null;
  let shareTimedOut = false;

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  function requireKeys(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
      throw new Error(label + '字段不符合第一版格式，未忽略任何字段。');
    }
  }
  async function digest(text) {
    if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持 SHA-256，请使用安全连接或本地测试地址。');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function validateItem(item, label) {
    requireKeys(item, FIELDS, label);
    if (!Number.isSafeInteger(item.id) || item.id <= 0) throw new Error(label + ' ID 无效。');
    if (typeof item.name !== 'string' || typeof item.location !== 'string') throw new Error(label + '名称或位置不是文本。');
    if (item.quantity !== null && (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity))) throw new Error(label + '数量无效。');
    for (const key of ['createdAt', 'updatedAt']) {
      if (!Number.isSafeInteger(item[key]) || item[key] < 0) throw new Error(label + ' ' + key + ' 无效。');
    }
    for (const key of ['photoClose', 'photoFar']) {
      const photo = item[key];
      if (photo === null) continue;
      if (typeof photo !== 'string') throw new Error(label + ' ' + key + ' 不是照片字符串或 null。');
      const match = /^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
      if (!match || match[1].length % 4 !== 0) throw new Error(label + ' ' + key + ' 编码不完整或格式不支持。');
      try { atob(match[1]); } catch { throw new Error(label + ' ' + key + ' Base64 无效。'); }
    }
  }
  function checkPhoto(photo, label) {
    if (photo === null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const image = new Image();
      const timer = setTimeout(() => finish(new Error(label + ' 解码超时，请重试。')), 30000);
      function finish(error) {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        image.removeAttribute('src');
        if (error) reject(error); else resolve();
      }
      image.onload = () => finish(image.naturalWidth && image.naturalHeight ? null : new Error(label + ' 图像尺寸无效。'));
      image.onerror = () => finish(new Error(label + ' 无法解码，未跳过照片。'));
      image.src = photo;
    });
  }
  async function inspectItem(item, label) {
    validateItem(item, label);
    await checkPhoto(item.photoClose, label + '近景照片');
    await checkPhoto(item.photoFar, label + '远景照片');
  }
  function assertReady() {
    if (!db.db) throw new Error('数据库尚未初始化，请稍后重试。');
    if (pendingItemWrites || pendingPhotoJobs || addModal.classList.contains('active') || editModal.classList.contains('active')) {
      throw new Error('请先完成或取消当前录入、编辑，并等待照片处理和保存结束，再备份。');
    }
  }
  function resetGenerated() {
    generatedFile = null;
    share.hidden = download.hidden = true;
    if (downloadURL) { URL.revokeObjectURL(downloadURL); downloadURL = null; }
  }
  function setBusy(value) {
    busy = value;
    family.disabled = generate.disabled = fileInput.disabled = close.disabled = value;
    share.disabled = download.disabled = value;
    verify.disabled = value || !fileInput.files.length;
  }
  async function task(work) {
    if (busy) return;
    setBusy(true);
    try { await work(); }
    catch (error) {
      status.textContent = '操作未完成：' + (error.message || String(error)) + '\n原数据库未被备份功能修改。';
    } finally { setBusy(false); }
  }

  // Serialize one record at a time in ONE readonly snapshot. No createdAt index:
  // even records missing an index value must be inspected, never silently omitted.
  function readSnapshot() {
    return new Promise((resolve, reject) => {
      const parts = [];
      let failure = null;
      const tx = db.db.transaction(STORE_NAME, 'readonly');
      tx.onabort = () => reject(failure || tx.error || new Error('读取事务中止。'));
      tx.onerror = () => { failure = failure || tx.error; };
      tx.oncomplete = () => resolve(parts);
      const request = tx.objectStore(STORE_NAME).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          validateItem(cursor.value, '记录 ' + cursor.primaryKey);
          parts.push(canonical(cursor.value));
          cursor.continue();
        } catch (error) { failure = error; tx.abort(); }
      };
    });
  }

  el('btn-backup-trigger').addEventListener('click', () => {
    if (busy) { showToast('备份任务仍在处理中。若系统分享一直未返回，请先检查文件，再重新打开应用。', 5000); return; }
    try { assertReady(); }
    catch (error) { showToast(error.message, 4000); return; }
    lastFocus = document.activeElement;
    if (!busy) {
      resetGenerated();
      family.value = '';
      fileInput.value = '';
      verify.disabled = true;
      status.textContent = '请选择家庭后生成备份。也可以直接选择旧备份核验。';
    }
    openModal(modal);
    family.focus();
  });
  close.addEventListener('click', () => {
    if (busy && !shareTimedOut) return;
    resetGenerated();
    fileInput.value = '';
    closeModal(modal);
    lastFocus?.focus();
  });
  // Keep background controls unreachable, including keyboard navigation. Existing
  // business handlers remain untouched; nothing is saved by opening this modal.
  document.addEventListener('click', event => {
    if (modal.classList.contains('active') && !modal.contains(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy || shareTimedOut) close.click(); }
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button, select, input')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  family.addEventListener('change', () => {
    resetGenerated();
    status.textContent = family.value ? '当前操作：' + family.value + '（由你确认）。请确认来自正确桌面入口。' : '请手动选择家庭。';
  });

  generate.addEventListener('click', () => task(async () => {
    assertReady();
    if (!['广安', '远达'].includes(family.value)) throw new Error('请先手动选择广安或远达。');
    resetGenerated();
    status.textContent = '正在读取当前入口的全部记录，请保持应用在前台…';
    const parts = await readSnapshot();
    const recordHashes = [];
    let closeCount = 0, farCount = 0;
    for (let i = 0; i < parts.length; i++) {
      const item = JSON.parse(parts[i]);
      status.textContent = '正在检查记录和照片：' + (i + 1) + '/' + parts.length;
      await inspectItem(item, '记录 ' + item.id);
      if (item.photoClose !== null) closeCount++;
      if (item.photoFar !== null) farCount++;
      recordHashes.push(await digest(parts[i]));
    }
    const now = new Date();
    const metadata = {
      appId: APP_ID, formatVersion: FORMAT_VERSION, familyName: family.value,
      exportedAt: now.toISOString(),
      database: { name: DB_NAME, version: db.db.version, store: STORE_NAME, keyPath: 'id', autoIncrement: true, indexes: [{ name: 'createdAt', keyPath: 'createdAt', unique: false }] },
      counts: { records: parts.length, photoClose: closeCount, photoFar: farCount }
    };
    const integrity = { algorithm: ALGORITHM, recordHashes, manifestHash: await digest(canonical({ metadata, recordHashes })) };
    // Compose one JSON document without joining all records into a giant string.
    for (let i = 1; i < parts.length; i++) parts[i] = ',' + parts[i];
    const pad = number => String(number).padStart(2, '0');
    const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
    const time = [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
    generatedFile = new File(['{"metadata":', canonical(metadata), ',"items":[', ...parts, '],"integrity":', canonical(integrity), '}'],
      '收纳助手_' + family.value + '_' + date + '_' + time + '.json', { type: 'application/json' });
    let canShare = false;
    try { canShare = !!navigator.share && !!navigator.canShare?.({ files: [generatedFile] }); } catch { /* Download remains available. */ }
    share.hidden = !canShare;
    download.hidden = false;
    status.textContent = '文件已生成，尚未确认保存。\n当前数据：' + family.value + '\n' + parts.length + ' 条记录；近景 ' + closeCount + ' 张，远景 ' + farCount + ' 张。\n文件大小：' + (generatedFile.size / 1024 / 1024).toFixed(2) + ' MiB。\n' +
      (canShare ? '请选择系统分享或下载，再重新选择文件核验。' : '此环境未确认支持分享 JSON 文件，请使用当前入口内的下载备用方式。');
  }));

  share.addEventListener('click', () => task(async () => {
    if (!generatedFile) throw new Error('请先生成备份。');
    status.textContent = '系统分享处理中，请选择“存储到文件”。尚未确认保存或 iCloud 同步。';
    shareTimedOut = false;
    const timer = setTimeout(() => {
      shareTimedOut = true;
      status.textContent = '系统尚未返回分享结果，请先关闭系统分享面板。可以关闭此窗口继续使用原功能；若一直没有返回，请检查文件后重新打开应用，再核验备份。尚未确认保存。';
      // A broken OS share callback must not permanently lock the application.
      close.disabled = false;
    }, 30000);
    try {
      // Directly invoked by this click, without preceding asynchronous work.
      await navigator.share({ files: [generatedFile] });
      status.textContent = '已交给系统处理，尚未确认文件保存。请在“文件”中检查并重新选择核验；应用无法确认 iCloud 同步状态。';
    } catch (error) {
      if (error.name === 'AbortError') status.textContent = '分享未完成，可能已取消或没有可用目标。尚未确认保存，可重试或下载。';
      else throw new Error('系统分享未完成（' + error.name + '）：' + error.message + '。请检查“文件”，或使用下载备用方式。');
    } finally { clearTimeout(timer); shareTimedOut = false; }
  }));
  download.addEventListener('click', () => {
    if (busy || !generatedFile) return;
    try {
      if (downloadURL) URL.revokeObjectURL(downloadURL);
      downloadURL = URL.createObjectURL(generatedFile);
      const link = document.createElement('a');
      link.href = downloadURL;
      link.download = generatedFile.name;
      modal.appendChild(link);
      link.click(); link.remove();
      status.textContent = '已发起下载，尚未确认保存。请在“文件”中检查，然后重新选择文件核验；应用无法确认 iCloud 同步状态。';
    } catch (error) { status.textContent = '下载未启动：' + error.message; }
  });

  fileInput.addEventListener('change', () => {
    verify.disabled = busy || !fileInput.files.length;
    if (fileInput.files.length) status.textContent = '已选择 ' + fileInput.files[0].name + '（' + (fileInput.files[0].size / 1024 / 1024).toFixed(2) + ' MiB）。核验不会恢复或修改数据库；大文件需要较多内存。';
  });
  verify.addEventListener('click', () => task(async () => {
    const selected = fileInput.files[0];
    if (!selected) throw new Error('请先选择备份文件。');
    // Release generated artifacts before whole-file parsing to reduce overlap.
    resetGenerated();
    status.textContent = '正在读取和核验文件，请保持应用在前台…';
    let backup;
    try { backup = JSON.parse(await selected.text()); }
    catch { throw new Error('文件不是可读取的完整 JSON，可能已损坏或设备内存不足。'); }
    requireKeys(backup, ['metadata', 'items', 'integrity'], '备份');
    const { metadata, items, integrity } = backup;
    requireKeys(metadata, ['appId', 'formatVersion', 'familyName', 'exportedAt', 'database', 'counts'], '元信息');
    if (metadata.appId !== APP_ID || metadata.formatVersion !== FORMAT_VERSION) throw new Error('应用标识或备份版本不支持。');
    if (!['广安', '远达'].includes(metadata.familyName) || typeof metadata.exportedAt !== 'string' || !Number.isFinite(Date.parse(metadata.exportedAt))) throw new Error('家庭或导出时间无效。');
    const expectedDB = { name: DB_NAME, version: DB_VERSION, store: STORE_NAME, keyPath: 'id', autoIncrement: true, indexes: [{ name: 'createdAt', keyPath: 'createdAt', unique: false }] };
    if (canonical(metadata.database) !== canonical(expectedDB)) throw new Error('数据库信息不符合第一版格式。');
    requireKeys(metadata.counts, ['records', 'photoClose', 'photoFar'], '统计');
    requireKeys(integrity, ['algorithm', 'recordHashes', 'manifestHash'], '校验信息');
    if (!Array.isArray(items) || integrity.algorithm !== ALGORITHM || !Array.isArray(integrity.recordHashes) || integrity.recordHashes.length !== items.length) throw new Error('记录或校验清单无效。');
    if (await digest(canonical({ metadata, recordHashes: integrity.recordHashes })) !== integrity.manifestHash) throw new Error('清单完整性校验不通过，文件可能被修改或损坏。');
    const ids = new Set();
    let closeCount = 0, farCount = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      status.textContent = '正在核验记录和照片：' + (i + 1) + '/' + items.length;
      await inspectItem(item, '第 ' + (i + 1) + ' 条记录');
      if (ids.has(item.id)) throw new Error('备份存在重复 ID：' + item.id);
      ids.add(item.id);
      if (await digest(canonical(item)) !== integrity.recordHashes[i]) throw new Error('记录 ' + item.id + ' 完整性校验不通过。');
      if (item.photoClose !== null) closeCount++;
      if (item.photoFar !== null) farCount++;
    }
    if (metadata.counts.records !== items.length || metadata.counts.photoClose !== closeCount || metadata.counts.photoFar !== farCount) throw new Error('记录数量或照片数量不一致。');
    status.textContent = '所选备份文件完整，已核验。\n文件标注家庭：' + metadata.familyName + '（导出时人工确认）\n导出时间：' + metadata.exportedAt + '\n' + items.length + ' 条记录；近景 ' + closeCount + ' 张，远景 ' + farCount + ' 张。\n仅核验文件，未恢复数据；不能据此确认 iCloud 已同步。' +
      (family.value && family.value !== metadata.familyName ? '\n注意：文件家庭与当前手动选择不同，请检查是否选错文件。' : '');
  }));
})();
