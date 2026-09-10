// --- Content Script: Runs inside WhatsApp Web ---

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
      // 1. Wait for the chat to load (sometimes takes a second)
      await waitForElement('div[contenteditable="true"][data-tab="10"]', 5000);
      
      // 2. Find the message input box
      const inputBox = document.querySelector('div[contenteditable="true"][data-tab="10"]');
      
      if (!inputBox) {
        // Check if it's an invalid number popup
        if (document.querySelector('span[data-testid="block-dialog"]')) {
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