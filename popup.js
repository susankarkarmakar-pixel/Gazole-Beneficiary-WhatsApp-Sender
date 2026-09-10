// --- Global Variables ---
let beneficiaries = [];
let csvHeaders = [];
let isSending = false;

// --- DOM Elements ---
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const fileInput = document.getElementById('csvFile');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileRows = document.getElementById('fileRows');
const columnMapping = document.getElementById('columnMapping');
const mappingGrid = document.getElementById('mappingGrid');
const messageTemplate = document.getElementById('messageTemplate');
const chipsContainer = document.getElementById('chipsContainer');
const previewBtn = document.getElementById('previewBtn');
const previewSection = document.getElementById('previewSection');
const previewContainer = document.getElementById('previewContainer');
const startBtn = document.getElementById('startBtn');
const statusMessage = document.getElementById('statusMessage');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  setupFileUpload();
  setupVariableChips();
  setupPreview();
  setupStartButton();
});

// --- 1. Tab Switching Logic ---
function setupTabs() {
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab') + 'Tab';
      document.getElementById(tabId).classList.add('active');
    });
  });
}

// --- 2. CSV File Upload & Parsing ---
function setupFileUpload() {
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      parseCSV(text);
    };
    reader.readAsText(file);
  });
}

function parseCSV(text) {
  // Simple CSV parser
  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    showStatus('Invalid CSV file. Must have headers and at least one row.', 'error');
    return;
  }

  // Extract headers (remove quotes if any)
  csvHeaders = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  
  // Extract data
  beneficiaries = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle simple comma separation. For complex CSVs with commas inside quotes, a regex is needed.
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    let row = {};
    csvHeaders.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    beneficiaries.push(row);
  }

  // Update UI
  fileName.textContent = fileInput.files[0].name;
  fileRows.textContent = beneficiaries.length;
  fileInfo.style.display = 'block';
  
  generateVariableChips();
  showStatus(`Successfully loaded ${beneficiaries.length} beneficiaries!`, 'success');
  
  // Enable start button if message is not empty
  checkStartButton();
}

// --- 3. Dynamic Variable Chips ---
function setupVariableChips() {
  // Chips are generated dynamically when CSV is loaded
}

function generateVariableChips() {
  chipsContainer.innerHTML = '';
  csvHeaders.forEach(header => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `{{${header}}}`;
    chip.addEventListener('click', () => insertVariable(`{{${header}}}`));
    chipsContainer.appendChild(chip);
  });
}

function insertVariable(variable) {
  const startPos = messageTemplate.selectionStart;
  const endPos = messageTemplate.selectionEnd;
  const text = messageTemplate.value;
  
  messageTemplate.value = text.substring(0, startPos) + variable + text.substring(endPos);
  messageTemplate.focus();
  messageTemplate.selectionStart = messageTemplate.selectionEnd = startPos + variable.length;
  checkStartButton();
}

// --- 4. Message Preview ---
function setupPreview() {
  previewBtn.addEventListener('click', () => {
    if (beneficiaries.length === 0) {
      showStatus('Please upload a CSV file first.', 'error');
      return;
    }
    if (!messageTemplate.value.trim()) {
      showStatus('Please write a message template.', 'error');
      return;
    }

    generatePreview();
    previewSection.style.display = 'block';
  });
}

function generatePreview() {
  previewContainer.innerHTML = '';
  const template = messageTemplate.value;
  
  // Show preview for first 3 beneficiaries
  const previewCount = Math.min(3, beneficiaries.length);
  
  for (let i = 0; i < previewCount; i++) {
    const data = beneficiaries[i];
    let message = template;
    
    // Replace variables
    csvHeaders.forEach(header => {
      const regex = new RegExp(`{{${header}}}`, 'g');
      message = message.replace(regex, data[header] || 'N/A');
    });

    // Add signature if checked
    if (document.getElementById('autoSignature').checked) {
      message += '\n\n- Gazole BDO Office';
    }

    const previewItem = document.createElement('div');
    previewItem.className = 'preview-item';
    previewItem.innerHTML = `<strong>To: ${data['Name'] || data['Phone'] || 'Beneficiary ' + (i+1)}</strong>${message.replace(/\n/g, '<br>')}`;
    previewContainer.appendChild(previewItem);
  }
}

// --- 5. Start Button & Settings ---
function setupStartButton() {
  messageTemplate.addEventListener('input', checkStartButton);
  
  startBtn.addEventListener('click', () => {
    if (beneficiaries.length === 0) {
      showStatus('Please upload a CSV file first.', 'error');
      return;
    }
    if (!messageTemplate.value.trim()) {
      showStatus('Please write a message.', 'error');
      return;
    }

    // Save current settings
    saveSettings();

    // Prepare payload for background script
    const payload = {
      action: 'START_SENDING',
      beneficiaries: beneficiaries,
      template: messageTemplate.value,
      addSignature: document.getElementById('autoSignature').checked,
      settings: {
        minDelay: parseInt(document.getElementById('minDelay').value),
        maxDelay: parseInt(document.getElementById('maxDelay').value),
        phaseCooldown: parseInt(document.getElementById('phaseCooldown').value),
        batchSize: parseInt(document.getElementById('batchSize').value)
      }
    };

    // Send to background script
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error starting process.', 'error');
      } else {
        showStatus('Process started! Keep this tab open.', 'success');
        // Switch to a "Sending" state UI (optional, can be expanded)
      }
    });
  });
}

function checkStartButton() {
  if (beneficiaries.length > 0 && messageTemplate.value.trim().length > 0) {
    startBtn.disabled = false;
  } else {
    startBtn.disabled = true;
  }
}

// --- 6. Local Storage for Settings ---
function saveSettings() {
  const settings = {
    minDelay: document.getElementById('minDelay').value,
    maxDelay: document.getElementById('maxDelay').value,
    phaseCooldown: document.getElementById('phaseCooldown').value,
    batchSize: document.getElementById('batchSize').value,
    autoSignature: document.getElementById('autoSignature').checked
  };
  chrome.storage.local.set({ 'gazoleSettings': settings });
}

function loadSettings() {
  chrome.storage.local.get('gazoleSettings', (result) => {
    if (result.gazoleSettings) {
      const s = result.gazoleSettings;
      document.getElementById('minDelay').value = s.minDelay || 5;
      document.getElementById('maxDelay').value = s.maxDelay || 15;
      document.getElementById('phaseCooldown').value = s.phaseCooldown || 5;
      document.getElementById('batchSize').value = s.batchSize || 50;
      document.getElementById('autoSignature').checked = s.autoSignature !== false;
    }
  });
}

// --- Helper: Status Message ---
function showStatus(msg, type) {
  statusMessage.textContent = msg;
  statusMessage.className = 'status-message ' + type;
  setTimeout(() => {
    statusMessage.textContent = '';
    statusMessage.className = 'status-message';
  }, 4000);
}