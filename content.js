// --- Content Script: Runs inside WhatsApp Web ---

// UI Injection logic
function injectUI() {
  // Check if button already exists
  if (document.getElementById('wa-sender-btn')) return;

  // We look for a good place to inject the button. Usually the header works best.
  // WhatsApp's DOM changes often, so we might need to find a stable container.
  // One common stable element is the top header.

  const headerSelectors = [
    'header',
    '#side header',
    'div[data-testid="chatlist-header"]'
  ];

  let targetHeader = null;
  for (const selector of headerSelectors) {
    targetHeader = document.querySelector(selector);
    if (targetHeader) break;
  }

  if (targetHeader) {
    const btn = document.createElement('button');
    btn.id = 'wa-sender-btn';
    btn.innerHTML = '🚀 Sender';
    btn.style.cssText = `
      background-color: #fff;
      border: 1px solid #128C7E;
      color: #128C7E;
      border-radius: 4px;
      padding: 5px 10px;
      margin-left: 10px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      z-index: 1000;
    `;

    // Attempt to append to the right side of the header
    const rightIconsContainer = targetHeader.lastElementChild;
    if (rightIconsContainer) {
       rightIconsContainer.style.display = 'flex';
       rightIconsContainer.style.alignItems = 'center';
       rightIconsContainer.insertBefore(btn, rightIconsContainer.firstChild);
    } else {
       targetHeader.appendChild(btn);
    }

    btn.addEventListener('click', toggleSidebar);
  }
}

let sidebarIframe = null;

function toggleSidebar() {
  if (sidebarIframe) {
    if (sidebarIframe.style.display === 'none') {
      sidebarIframe.style.display = 'block';
    } else {
      sidebarIframe.style.display = 'none';
    }
  } else {
    createSidebar();
  }
}

function createSidebar() {
  sidebarIframe = document.createElement('iframe');
  sidebarIframe.src = chrome.runtime.getURL('popup.html');
  sidebarIframe.style.cssText = `
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    height: 100%;
    border: none;
    border-left: 1px solid #ccc;
    background: #f0f2f5;
    z-index: 9999;
    box-shadow: -2px 0 5px rgba(0,0,0,0.1);
  `;
  document.body.appendChild(sidebarIframe);
}

// Observe body for WhatsApp loading to inject button
const observer = new MutationObserver(() => {
  injectUI();
});
observer.observe(document.body, { childList: true, subtree: true });

// Try injecting initially as well
setTimeout(injectUI, 3000);


// --- Helper: Sleep ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let currentState = null;
let isProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_SENDING_LOOP') {
    currentState = message.state;
    processNextBatch();
    sendResponse({ status: 'started' });
  } else if (message.action === 'PAUSE_SENDING') {
    if (currentState) currentState.isPaused = true;
    sendResponse({ status: 'paused' });
  } else if (message.action === 'RESUME_SENDING') {
    if (currentState && currentState.isPaused) {
      currentState.isPaused = false;
      processNextBatch();
    }
    sendResponse({ status: 'resumed' });
  } else if (message.action === 'STOP_SENDING') {
    if (currentState) currentState.isRunning = false;
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'TYPE_AND_SEND') {
    typeAndSend(message.phone, message.message, message.attachment)
      .then(() => sendResponse({ status: 'sent' }))
      .catch(error => sendResponse({ status: 'failed', error: error.message }));
  }
  return true;
});

// A WhatsApp Web reload destroys this content script's in-memory state. Restore
// the persisted background state so an active campaign resumes without needing
// a full browser restart.
function hydrateStateAndResume() {
  chrome.runtime.sendMessage({ action: 'GET_STATE' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.state) return;

    currentState = response.state;
    if (currentState.isRunning && !currentState.isPaused) {
      processNextBatch();
    }
  });
}

hydrateStateAndResume();

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function processNextBatch() {
  if (!currentState || !currentState.isRunning || currentState.isPaused) return;
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { batchSize, minDelay, maxDelay, phaseCooldown } = currentState.settings;
    const startIndex = currentState.currentIndex;
    const endIndex = Math.min(startIndex + batchSize, currentState.beneficiaries.length);

    // Notify background script of UI update
    chrome.runtime.sendMessage({ action: 'SYNC_STATE', state: currentState });

    for (let i = startIndex; i < endIndex; i++) {
      if (!currentState.isRunning || currentState.isPaused) break;

      const dailyLimitStatus = await checkDailyLimit();
      if (!dailyLimitStatus.allowed) {
        currentState.isPaused = true;
        chrome.runtime.sendMessage({
          action: 'DAILY_LIMIT_REACHED',
          resumeAt: dailyLimitStatus.resumeAt
        });
        break;
      }

      const beneficiary = currentState.beneficiaries[i];
      const success = await sendMessageToWhatsApp(beneficiary);

      const delay = randomDelay(minDelay, maxDelay);
      await sleep(delay * 1000);

      currentState.currentIndex++;
      if (success) {
        currentState.sentCount++;
        chrome.runtime.sendMessage({ action: 'RECORD_DAILY_SEND' });
      }
      chrome.runtime.sendMessage({ action: 'SYNC_STATE', state: currentState });
    }

    if (!currentState.isRunning || currentState.isPaused) return;

    currentState.currentPhase++;
    chrome.runtime.sendMessage({ action: 'SYNC_STATE', state: currentState });

    if (currentState.currentIndex < currentState.beneficiaries.length) {
      chrome.runtime.sendMessage({ action: 'SHOW_NOTIFICATION', message: `Phase ${currentState.currentPhase - 1} complete. Next phase in ${phaseCooldown} minutes...` });
      await sleep(phaseCooldown * 60 * 1000);
      if (currentState.isRunning && !currentState.isPaused) {
        // Let finally release the guard before starting the next phase.
        setTimeout(() => processNextBatch(), 0);
      }
    } else {
      currentState.isRunning = false;
      chrome.runtime.sendMessage({ action: 'SYNC_STATE', state: currentState });
      chrome.runtime.sendMessage({ action: 'SHOW_NOTIFICATION', message: `✅ Complete! Sent: ${currentState.sentCount}, Failed: ${currentState.failedCount}` });
    }
  } finally {
    // Also releases the guard for pause, stop, daily-limit, errors, and completion.
    isProcessing = false;
  }
}

function checkDailyLimit() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'CHECK_DAILY_LIMIT' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ allowed: currentState.settings.dailyLimitEnabled === false });
        return;
      }
      resolve(response);
    });
  });
}

function normalizePhoneNumber(rawPhone) {
  const raw = String(rawPhone || '').trim();
  const hasLeadingPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  let normalized;

  if (hasLeadingPlus) {
    normalized = `+${digits}`;
  } else if (digits.startsWith('91') && digits.length === 12) {
    normalized = `+${digits}`;
  } else if (digits.startsWith('0') && digits.length === 11) {
    normalized = `+91${digits.slice(1)}`;
  } else if (digits.length === 10) {
    normalized = `+91${digits}`;
  } else {
    throw new Error('Unrecognized phone format');
  }

  if (!/^\+91\d{10}$/.test(normalized)) {
    throw new Error('Unrecognized phone format');
  }
  return normalized;
}

async function sendMessageToWhatsApp(beneficiary) {
  try {
    const phone = normalizePhoneNumber(beneficiary.Phone || beneficiary.phone || beneficiary['Phone Number'] || '');

    let message = currentState.template;
    const headers = Object.keys(beneficiary);
    headers.forEach(header => {
      const regex = new RegExp(`{{${header}}}`, 'g');
      message = message.replace(regex, beneficiary[header] || '');
    });

    if (currentState.addSignature) message += '\n\n- Gazole BDO Office';

    await typeAndSend(phone, message, currentState.attachment || null);

    currentState.sentNumbers.push({
      phone: phone,
      name: beneficiary.Name || 'Unknown',
      time: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    currentState.failedCount++;
    currentState.failedNumbers.push({
      phone: beneficiary.Phone || 'Unknown',
      name: beneficiary.Name || 'Unknown',
      reason: error.message
    });
    return false;
  }
}

async function typeAndSend(phone, message, attachment) {
    phone = normalizePhoneNumber(phone);

    // Look for new chat button
    const newChatBtn = document.querySelector('div[title="New chat"], div[data-testid="chat"]');
    if (newChatBtn) {
      newChatBtn.click();
      await sleep(1000);
      const searchBox = document.querySelector('div[contenteditable="true"][data-testid="chat-list-search"]');
      if (searchBox) {
        searchBox.focus();
        document.execCommand('insertText', false, phone);
        await sleep(2000);
        const searchResult = document.querySelector('div[data-testid="cell-frame-container"]');
        if (searchResult) {
          searchResult.click();
        } else {
          // Look for 'No results found' or similar
          throw new Error('Number not found on WhatsApp or invalid');
        }
      } else {
         throw new Error('Could not find search box');
      }
    } else {
      // Fallback API if available
      const link = document.createElement('a');
      link.href = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    await sleep(3000); // Wait for chat to load
    if (attachment) {
      await attachAndSendFile(attachment);
    }

    // Send the caption/text separately. This avoids relying on WhatsApp's
    // attachment-caption composer, which changes more frequently than text chat.
    if (message && message.trim()) {
      await executeWhatsAppAction(message);
    }
}

async function attachAndSendFile(attachment) {
  if (!attachment.dataUrl || !attachment.name) {
    throw new Error('Attachment data is missing');
  }

  const attachButton = await findFirstElement([
    'span[data-icon="clip"]',
    '[data-testid="clip"]',
    'button[aria-label*="Attach"]',
    'div[role="button"][aria-label*="Attach"]'
  ], 5000);
  if (!attachButton) throw new Error('WhatsApp attachment button not found');
  attachButton.click();

  await sleep(500);
  selectAttachmentMenuItem(attachment.type);
  const fileInput = await findAttachmentInput(attachment.type, 5000);
  if (!fileInput) throw new Error('WhatsApp attachment file input not found');

  const blob = await (await fetch(attachment.dataUrl)).blob();
  const file = new File([blob], attachment.name, { type: attachment.type || blob.type });
  const transfer = new DataTransfer();
  transfer.items.add(file);

  try {
    fileInput.files = transfer.files;
  } catch (error) {
    throw new Error('WhatsApp rejected the attachment file input');
  }
  fileInput.dispatchEvent(new Event('input', { bubbles: true }));
  fileInput.dispatchEvent(new Event('change', { bubbles: true }));

  const sendButton = await findFirstElement([
    'span[data-icon="send"]',
    'button[aria-label="Send"]',
    '[data-testid="send"]'
  ], 10000);
  if (!sendButton) throw new Error('WhatsApp attachment send button not found');
  sendButton.click();
  await sleep(1000);
}

async function findAttachmentInput(fileType, timeout) {
  const wantsMedia = fileType.startsWith('image/') || fileType.startsWith('video/');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter(input => !input.disabled);
    const matching = inputs.find(input => {
      const accept = (input.getAttribute('accept') || '').toLowerCase();
      if (!accept) return false;
      return wantsMedia ? accept.includes('image') || accept.includes('video') : !accept.includes('image') && !accept.includes('video');
    });
    if (matching || inputs[0]) return matching || inputs[0];
    await sleep(100);
  }
  return null;
}

function selectAttachmentMenuItem(fileType) {
  const wantsMedia = fileType.startsWith('image/') || fileType.startsWith('video/');
  const wantedLabels = wantsMedia
    ? ['Photos & videos', 'Photos and videos', 'Photo']
    : ['Document', 'Documents'];
  const menuItems = Array.from(document.querySelectorAll('[role="button"], button, li, div'));
  const item = menuItems.find(element => {
    const text = (element.textContent || '').trim().toLowerCase();
    return text && wantedLabels.some(label => text === label.toLowerCase());
  });
  if (item) item.click();
}

async function findFirstElement(selectors, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.offsetParent !== null) return element;
    }
    await sleep(100);
  }
  return null;
}

async function executeWhatsAppAction(text) {
  return new Promise(async (resolve, reject) => {
    try {
      // Message input box selectors (WhatsApp updates these frequently)
      const inputSelectors = [
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][title="Type a message"]',
        'div[contenteditable="true"][title="Type a message\u2026"]',
        '#main footer div[contenteditable="true"]'
      ];
      
      // 1. Wait for the chat to load (sometimes takes a second)
      let inputBox = null;
      for (const selector of inputSelectors) {
        try {
          inputBox = await waitForElement(selector, 2000);
          if (inputBox) break;
        } catch (e) {
          // ignore timeout and try next selector
        }
      }
      
      if (!inputBox) {
        // These selectors should be periodically re-verified against live WhatsApp Web;
        // they are the most likely part of this flow to silently break over time.
        const invalidNumberDialog = document.querySelector('span[data-testid="block-dialog"], div[data-testid="popup-contents"]');
        if (invalidNumberDialog) {
          closeInvalidNumberPopup();
          reject(new Error('Invalid number or not on WhatsApp'));
          return;
        }
        const domSnippet = (document.body && (document.body.innerText || document.body.textContent) || '').slice(0, 300);
        console.warn('WhatsApp message input unavailable', {
          url: window.location.href,
          domSnippet
        });
        reject(new Error('Unknown failure (number may be invalid or page did not load)'));
        return;
      }

      // 3. Focus and clear the input box
      inputBox.focus();
      inputBox.innerHTML = ''; // Clear any existing text
      
      // 4. Type the message (Using execCommand for React compatibility)
      document.execCommand('insertText', false, text);
      
      // Trigger input event to ensure React state updates
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));

      // 5. Wait for the send button to become active
      await sleep(500);
      
      const sendButton = document.querySelector('span[data-icon="send"]');
      
      if (!sendButton) {
        reject(new Error('Send button not found (maybe empty message?)'));
        return;
      }

      // 6. Click the send button
      sendButton.click();
      
      resolve('Message sent successfully');

    } catch (error) {
      reject(error);
    }
  });
}

// --- Helper: Close Invalid Number Popup ---
function closeInvalidNumberPopup() {
  const okButton = document.querySelector('div[role="button"] span[data-testid="block-dialog-ok-button"]');
  if (okButton) {
    okButton.click();
  } else {
    // Fallback: click the first button in the dialog
    const buttons = document.querySelectorAll('div[role="dialog"] button');
    if (buttons.length > 0) buttons[0].click();
  }
}

// --- Helper: Wait for an element to appear in DOM ---
function waitForElement(selector, timeout) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}
