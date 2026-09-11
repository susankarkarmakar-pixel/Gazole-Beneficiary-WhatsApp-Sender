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


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'TYPE_AND_SEND') {
    executeWhatsAppAction(message.text)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // Keep channel open for async response
  }
});

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
        // Check if it's an invalid number popup
        if (document.querySelector('span[data-testid="block-dialog"]') || document.querySelector('div[data-testid="popup-contents"]')) {
          closeInvalidNumberPopup();
          reject(new Error('Invalid number or not on WhatsApp'));
          return;
        }
        reject(new Error('Message input box not found'));
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

// --- Helper: Sleep ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}