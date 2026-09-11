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

// --- Message Listener from Popup & Content Script ---
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
  else if (message.action === 'TEST_SEND') {
    sendTestMessage(message.phone, message.message, message.attachment, sendResponse);
  }
  else if (message.action === 'SYNC_STATE') {
    currentState = message.state;
    saveState();
    updateUI();
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'SHOW_NOTIFICATION') {
    showNotification(message.message);
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

async function sendTestMessage(phone, message, attachment, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    let tabId;

    if (tabs.length === 0) {
      const newTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
      tabId = newTab.id;
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      tabId = tabs[0].id;
    }

    chrome.tabs.sendMessage(tabId, {
      action: 'TYPE_AND_SEND',
      phone,
      message,
      attachment
    }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ status: 'failed', error: chrome.runtime.lastError.message });
      } else if (response && response.status === 'sent') {
        sendResponse({ status: 'sent' });
      } else {
        sendResponse({ status: 'failed', error: (response && response.error) || 'WhatsApp did not confirm the message.' });
      }
    });
  } catch (error) {
    sendResponse({ status: 'failed', error: error.message });
  }
}

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
    attachment: data.attachment || null,
    settings: data.settings,
    phaseStartTime: Date.now()
  };

  await saveState();

  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  let tabId;
  
  if (tabs.length === 0) {
    const newTab = await chrome.tabs.create({ url: 'https://web.whatsapp.com' });
    tabId = newTab.id;
    await new Promise(resolve => setTimeout(resolve, 5000));
  } else {
    tabId = tabs[0].id;
  }

  // Delegate loop to content script
  chrome.tabs.sendMessage(tabId, { action: 'START_SENDING_LOOP', state: currentState });
  updateUI();
}

// --- Pause/Resume/Stop Controls ---
function pauseSending() {
  currentState.isPaused = true;
  saveState();
  relayToWhatsApp({ action: 'PAUSE_SENDING' });
  updateUI();
}

function resumeSending() {
  if (currentState.isRunning && currentState.isPaused) {
    currentState.isPaused = false;
    saveState();
    relayToWhatsApp({ action: 'RESUME_SENDING' });
    updateUI();
  }
}

function stopSending() {
  currentState.isRunning = false;
  currentState.isPaused = false;
  saveState();
  relayToWhatsApp({ action: 'STOP_SENDING' });
  updateUI();
}

async function relayToWhatsApp(message) {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length > 0) {
    chrome.tabs.sendMessage(tabs[0].id, message);
  }
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
      relayToWhatsApp({ action: 'START_SENDING_LOOP', state: currentState });
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
