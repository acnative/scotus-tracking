chrome.action.onClicked.addListener(() => {
    chrome.tabs.create({ url: "https://www.supremecourt.gov/docket/docket.aspx" }, (tab) => {
      const tabId = tab.id;
      // Listen for the tab to finish loading
      chrome.tabs.onUpdated.addListener(function listener(updatedTabId, info) {
        if (updatedTabId === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          // Once the tab has finished loading, inject the content script.
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
          });
        }
      });
    });
  });