/**
 * Core application logic for Minimal Item Storage PWA
 */

// --- 1. INDEXEDDB MANAGER ---
const DB_NAME = 'ItemStorageDB';
const DB_VERSION = 1;
const STORE_NAME = 'items';

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
 * Max dimension: 1024px, JPEG Format, Quality: 0.75
 */
async function compressImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.75) {
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
  });
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


// --- 5. REGISTER SERVICE WORKER FOR OFFLINE ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service Worker registered with scope: ', reg.scope))
      .catch((err) => console.error('Service Worker registration failed: ', err));
  });
}


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