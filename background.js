// --- Global State ---
let currentState = {
  isRunning: false,
  isPaused: false,
  currentIndex: 0,
  currentPhase: 1,
  totalPhases: 1,
  sentCount: 0,
  failedCount: 0,
  failedNumbers: [],
  sentNumbers: [],
  beneficiaries: [],
  template: '',
  settings: {},
  phaseStartTime: null
};

// --- Load saved state on startup ---
chrome.runtime.onStartup.addListener(() => {
  loadState();
});

// --- Message Listener from Popup ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_SENDING') {
    startSending(message);
    sendResponse({ status: 'started' });
  } 
  else if (message.action === 'PAUSE') {
    pauseSending();
    sendResponse({ status: 'paused' });
  }
  else if (message.action === 'RESUME') {
    resumeSending();
    sendResponse({ status: 'resumed' });
  }
  else if (message.action === 'STOP') {
    stopSending();
    sendResponse({ status: 'stopped' });
  }
  else if (message.action === 'GET_STATE') {
    sendResponse({ state: currentState });
  }
  else if (message.action === 'MESSAGE_SENT') {
    handleSentMessage(message);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'MESSAGE_FAILED') {
    handleFailedMessage(message);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'EXPORT_REPORT') {
    exportReport();
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'EXPORT_FAILED') {
    exportFailedNumbers();
    sendResponse({ status: 'ok' });
  }
  
  return true; // Keep channel open for async response
});

// --- Start Sending Process ---
async function startSending(data) {
  // Initialize state
  currentState = {
    isRunning: true,
    isPaused: false,
    currentIndex: 0,
    currentPhase: 1,
    totalPhases: Math.ceil(data.beneficiaries.length / data.settings.batchSize),
    sentCount: 0,
    failedCount: 0,
    failedNumbers: [],
    sentNumbers: [],
    beneficiaries: data.beneficiaries,
    template: data.template,
    addSignature: data.addSignature,
    settings: data.settings,
    phaseStartTime: Date.now()
  };

  // Save state
  await saveState();

  // Open WhatsApp Web if not already open
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  
  if (tabs.length === 0) {
    await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
    // Wait for WhatsApp to load
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Start processing
  processNextBatch();
}

// --- Process Next Batch (Phase) ---
async function processNextBatch() {
  if (!currentState.isRunning || currentState.isPaused) return;

  const { batchSize, minDelay, maxDelay, phaseCooldown } = currentState.settings;
  const startIndex = currentState.currentIndex;
  const endIndex = Math.min(startIndex + batchSize, currentState.beneficiaries.length);

  // Update UI with phase info
  updateUI();

  // Process each beneficiary in current batch
  for (let i = startIndex; i < endIndex; i++) {
    if (!currentState.isRunning || currentState.isPaused) break;

    const beneficiary = currentState.beneficiaries[i];
    
    // Send message via content script
    await sendMessageToWhatsApp(beneficiary);

    // Random delay between messages
    const delay = randomDelay(minDelay, maxDelay);
    await sleep(delay * 1000);

    currentState.currentIndex++;
    currentState.sentCount++;
  }

  // Phase complete
  currentState.currentPhase++;
  currentState.phaseStartTime = Date.now();
  await saveState();
  updateUI();

  // Check if more phases remain
  if (currentState.currentIndex < currentState.beneficiaries.length && currentState.isRunning) {
    // Cooldown before next phase
    showNotification(`Phase ${currentState.currentPhase - 1} complete. Next phase in ${phaseCooldown} minutes...`);
    
    await sleep(phaseCooldown * 60 * 1000);
    
    if (currentState.isRunning && !currentState.isPaused) {
      processNextBatch();
    }
  } else {
    // All done!
    completeSending();
  }
}

// --- Send Message to WhatsApp ---
async function sendMessageToWhatsApp(beneficiary) {
  try {
    // Get phone number (ensure +91 prefix)
    let phone = beneficiary.Phone || beneficiary.phone || beneficiary['Phone Number'] || '';
    phone = phone.trim();
    if (!phone.startsWith('+')) {
      phone = '+91' + phone;
    }

    // Build message
    let message = currentState.template;
    const headers = Object.keys(beneficiary);
    
    headers.forEach(header => {
      const regex = new RegExp(`{{${header}}}`, 'g');
      message = message.replace(regex, beneficiary[header] || '');
    });

    if (currentState.addSignature) {
      message += '\n\n- Gazole BDO Office';
    }

    // Open WhatsApp tab with phone number
    const url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
    
    // Try to find existing WhatsApp tab or create new
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    let tab;
    
    if (tabs.length > 0) {
      tab = tabs[0];
      await chrome.tabs.update(tab.id, { url: url, active: true });
    } else {
      tab = await chrome.tabs.create({ url: url });
    }

    // Wait for page to load
    await sleep(3000);

    // Send message to content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'TYPE_AND_SEND',
      text: message
    });

    if (response && response.success) {
      currentState.sentNumbers.push({
        phone: phone,
        name: beneficiary.Name || 'Unknown',
        time: new Date().toISOString()
      });
    } else {
      throw new Error('Failed to send');
    }

  } catch (error) {
    console.error('Error sending message:', error);
    currentState.failedCount++;
    currentState.failedNumbers.push({
      phone: beneficiary.Phone || 'Unknown',
      name: beneficiary.Name || 'Unknown',
      reason: error.message
    });
  }
}

// --- Handle Message Sent (from content script) ---
function handleSentMessage(message) {
  // Update state if needed
  console.log('Message sent to:', message.phone);
}

// --- Handle Message Failed (from content script) ---
function handleFailedMessage(message) {
  currentState.failedCount++;
  currentState.failedNumbers.push({
    phone: message.phone,
    name: message.name || 'Unknown',
    reason: message.reason || 'Unknown error'
  });
  saveState();
}

// --- Pause/Resume/Stop Controls ---
function pauseSending() {
  currentState.isPaused = true;
  saveState();
  showNotification('Sending paused');
}

function resumeSending() {
  if (currentState.isRunning && currentState.isPaused) {
    currentState.isPaused = false;
    processNextBatch();
    showNotification('Sending resumed');
  }
}

function stopSending() {
  currentState.isRunning = false;
  currentState.isPaused = false;
  saveState();
  showNotification('Sending stopped');
}

function completeSending() {
  currentState.isRunning = false;
  currentState.isPaused = false;
  saveState();
  
  showNotification(`✅ Complete! Sent: ${currentState.sentCount}, Failed: ${currentState.failedCount}`);
  
  // Update UI
  updateUI();
}

// --- Utility Functions ---
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- State Management (Auto-Resume) ---
async function saveState() {
  await chrome.storage.local.set({ 'gazoleState': currentState });
}

async function loadState() {
  const result = await chrome.storage.local.get('gazoleState');
  if (result.gazoleState) {
    // Restore state and resume if it was running and not stopped
    currentState = result.gazoleState;

    if (currentState.isRunning && !currentState.isPaused) {
      console.log('Auto-resuming WhatsApp sender...');
      processNextBatch();
    }
  }
}

// --- UI Updates ---
function updateUI() {
  // Send state to popup if open
  chrome.runtime.sendMessage({
    action: 'STATE_UPDATE',
    state: currentState
  }).catch(() => {
    // Popup not open, ignore
  });
}

// --- Notifications ---
function showNotification(message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Gazole WhatsApp Sender',
    message: message,
    priority: 2
  });
}

// --- Export Functions ---
function exportReport() {
  const csv = convertToCSV(currentState.sentNumbers);
  downloadFile(csv, 'sent-report.csv');
}

function exportFailedNumbers() {
  const csv = convertToCSV(currentState.failedNumbers);
  downloadFile(csv, 'failed-numbers.csv');
}

function convertToCSV(data) {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(obj => headers.map(h => `"${obj[h]}"`).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}