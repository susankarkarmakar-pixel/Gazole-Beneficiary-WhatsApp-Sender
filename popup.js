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
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const exportReportBtn = document.getElementById('exportReport');
const exportFailedBtn = document.getElementById('exportFailed');
const statusMessage = document.getElementById('statusMessage');
const statsDashboard = document.getElementById('statsDashboard');
const progressSection = document.getElementById('progressSection');
const exportButtons = document.getElementById('exportButtons');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  setupFileUpload();
  setupPasteSection();
  setupVariableChips();
  setupAttachmentToggle();
  setupPreview();
  setupStartButton();
  setupControlButtons();
  setupStateListener();

  // Request current state from background script in case it's already running
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
    if (response && response.state) {
      updateUIWithState(response.state);
    }
  });
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
  // Robust CSV parser
  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const lines = text.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    showStatus('Invalid CSV file. Must have headers and at least one row.', 'error');
    return;
  }

  // Extract headers (remove quotes if any)
  csvHeaders = parseLine(lines[0]);
  
  // Extract data
  beneficiaries = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    let row = {};
    csvHeaders.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    beneficiaries.push(row);
  }

  // Update UI
  fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : 'Pasted Numbers';
  fileRows.textContent = beneficiaries.length;
  fileInfo.style.display = 'block';
  
  generateVariableChips();
  showStatus(`Successfully loaded ${beneficiaries.length} beneficiaries!`, 'success');
  
  // Enable start button if message is not empty
  checkStartButton();
}

// --- 2.5 Manual Paste Parsing ---
function setupPasteSection() {
  const processBtn = document.getElementById('processPastedBtn');
  const pasteNumbers = document.getElementById('pasteNumbers');

  if (processBtn && pasteNumbers) {
    processBtn.addEventListener('click', () => {
      const text = pasteNumbers.value.trim();
      if (!text) {
        showStatus('Please paste some numbers first.', 'error');
        return;
      }

      // Split by newline, comma, or tab
      const rawNumbers = text.split(/[\n,\t]+/);
      const parsedBeneficiaries = [];

      rawNumbers.forEach(raw => {
        // Strip out any characters that are not digits or a leading plus sign
        let cleanNumber = raw.replace(/[^\d+]/g, '');

        // Remove spaces, hyphens, parentheses (already handled by regex above, but keeping explicit if needed)
        // cleanNumber = cleanNumber.replace(/[\s\-\(\)]/g, '');

        if (cleanNumber.length >= 10) { // Basic validation
          parsedBeneficiaries.push({
            'Phone': cleanNumber,
            'Name': 'Beneficiary'
          });
        }
      });

      if (parsedBeneficiaries.length === 0) {
        showStatus('No valid phone numbers found.', 'error');
        return;
      }

      // Overwrite or append? Let's overwrite for simplicity, or append if users prefer
      beneficiaries = parsedBeneficiaries;
      csvHeaders = ['Phone', 'Name'];

      fileName.textContent = 'Pasted Numbers';
      fileRows.textContent = beneficiaries.length;
      fileInfo.style.display = 'block';

      generateVariableChips();
      showStatus(`Successfully loaded ${beneficiaries.length} numbers!`, 'success');

      checkStartButton();

      // Clear textarea
      pasteNumbers.value = '';
    });
  }
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

// --- 3.5 Attachment Handling ---
function setupAttachmentToggle() {
  const toggle = document.getElementById('sendAttachmentToggle');
  const section = document.getElementById('attachmentSection');
  const fileInput = document.getElementById('attachmentFile');
  const fileName = document.getElementById('attachmentFileName');

  if (toggle && section) {
    toggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        section.style.display = 'block';
      } else {
        section.style.display = 'none';
      }
    });
  }

  if (fileInput && fileName) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        fileName.textContent = e.target.files[0].name;
      } else {
        fileName.textContent = 'Choose File';
      }
    });
  }
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
        // Let the state update via background.js handle the UI
        chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
          if (res && res.state) {
            updateUIWithState(res.state);
          }
        });
      }
    });
  });
}

function setupControlButtons() {
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      if (pauseBtn.textContent.includes('Pause')) {
        chrome.runtime.sendMessage({ action: 'PAUSE' });
        pauseBtn.textContent = '▶️ Resume';
      } else {
        chrome.runtime.sendMessage({ action: 'RESUME' });
        pauseBtn.textContent = '⏸️ Pause';
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'STOP' });
    });
  }

  if (exportReportBtn) {
    exportReportBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'EXPORT_REPORT' });
    });
  }

  if (exportFailedBtn) {
    exportFailedBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'EXPORT_FAILED' });
    });
  }
}

function setupStateListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'STATE_UPDATE') {
      updateUIWithState(message.state);
    }
  });
}

function updateUIWithState(state) {
  // Update Stats
  const total = state.beneficiaries ? state.beneficiaries.length : 0;
  const sent = state.sentCount || 0;
  const failed = state.failedCount || 0;
  const pending = total - sent - failed;

  const totalStats = document.getElementById('totalStats');
  if (totalStats) totalStats.textContent = total;

  const sentStats = document.getElementById('sentStats');
  if (sentStats) sentStats.textContent = sent;

  const failedStats = document.getElementById('failedStats');
  if (failedStats) failedStats.textContent = failed;

  const pendingStats = document.getElementById('pendingStats');
  if (pendingStats) pendingStats.textContent = pending;

  if (statsDashboard) statsDashboard.style.display = 'flex';
  if (progressSection) progressSection.style.display = 'block';

  // Update Progress
  const currentPhase = document.getElementById('currentPhase');
  if (currentPhase) currentPhase.textContent = state.currentPhase || 1;

  const totalPhases = document.getElementById('totalPhases');
  if (totalPhases) totalPhases.textContent = state.totalPhases || 1;

  const progressCount = document.getElementById('progressCount');
  if (progressCount) progressCount.textContent = sent + failed;

  const totalCount = document.getElementById('totalCount');
  if (totalCount) totalCount.textContent = total;

  if (total > 0) {
    const progressPercent = ((sent + failed) / total) * 100;
    const progressFill = document.getElementById('progressFill');
    if (progressFill) progressFill.style.width = `${progressPercent}%`;
  }

  // Update Buttons visibility
  if (state.isRunning) {
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'inline-block';
    if (exportButtons) exportButtons.style.display = 'none';

    if (pauseBtn) {
      if (state.isPaused) {
        pauseBtn.textContent = '▶️ Resume';
      } else {
        pauseBtn.textContent = '⏸️ Pause';
      }
    }
  } else {
    if (startBtn) startBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';

    // Show export if finished or stopped after some sends
    if (total > 0 && (sent > 0 || failed > 0)) {
       if (exportButtons) exportButtons.style.display = 'flex';
    }
  }
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