// Add this at the start of the file, before any event listeners
function updateButtonsBasedOnURL(url) {
    const isSearchPage = (url.includes('flipkart.com/search?q=') || 
                         url.includes('amazon.in/s?k='));
    document.getElementById('scrape').disabled = isSearchPage;
    document.getElementById('scrapeAll').disabled = !isSearchPage;
}

// When popup opens, check current URL
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab && tab.url) {
        updateButtonsBasedOnURL(tab.url);
    }
});

document.getElementById('scrape').addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if ((tab.url.includes('flipkart.com') && !tab.url.includes('/search?q=')) || 
        (tab.url.includes('amazon') && !tab.url.includes('/s?k='))) {
        chrome.runtime.sendMessage({ action: "startScraping", tabId: tab.id, url: tab.url });
        document.getElementById('scrape').disabled = true;
        document.getElementById('scrapeAll').disabled = true;
        updateStatus("Scraping started... Please Don't click anywhere, it will take around 15 Seconds");
    } else {
        alert('Please navigate to a Flipkart or Amazon product page.');
    }
});

document.getElementById('scrapeAll').addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.url.includes('flipkart.com') || tab.url.includes('amazon.in')) {
        chrome.runtime.sendMessage({ action: "startScrapingAll", tabId: tab.id, url: tab.url });
        document.getElementById('scrapeAll').disabled = true;
        document.getElementById('scrape').disabled = true;

        updateStatus("Scraping all products started... Please Don't click anywhere, it will take around 15 Seconds");
    } else {
        alert('Please navigate to a Flipkart or Amazon search results page.');
    }
});

let reviewsReadyForDownload = false;

document.getElementById('download').addEventListener('click', () => {
    chrome.storage.local.get(["reviews"], (result) => {
        if (result.reviews && result.reviews.length > 0) {
            downloadReviews(result.reviews);
            // Reset extension state after download
            reviewsReadyForDownload = false;
            chrome.storage.local.remove("reviews", () => {
                document.getElementById('scrape').disabled = false;
                document.getElementById('scrapeAll').disabled = false;
                document.getElementById('download').disabled = true;
                updateStatus("Ready to scrape new reviews.");
            });
        } else {
            alert("No reviews to download.");
        }
    });
});

function downloadReviews(reviews) {
    if (!reviews || reviews.length === 0) {
        alert("No reviews to download.");
        return;
    }

    const productTitle = reviews[0].productTitle;

    // Build the JSON content.
    const jsonOutput = {
        product_name: productTitle,
        product_reviews: reviews.map(review => ({
            review: review.text,
            demographic: review.demographic,
            posting_date: review.posting_date
        }))
    };

    const jsonString = JSON.stringify(jsonOutput, null, 2); // Convert to JSON string (pretty-printed)

    // *** Sanitize the filename ***
    let safeFilename = productTitle.replace(/[/\\?%*:|"<>]/g, '-'); // Replace invalid chars with '-'
    safeFilename = safeFilename.substring(0, 50);       // Limit length (optional, but good practice)
    safeFilename = safeFilename || "reviews";          // Use "reviews" if title is empty after sanitization.
    safeFilename += "_reviews.json";                  // Add the .json extension
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
        url: url,
        filename: safeFilename, // Use the sanitized filename
        saveAs: true
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error("Download error:", chrome.runtime.lastError.message);
            updateStatus("Download failed. See console for details.");
        } else {
            console.log("Download started, ID:", downloadId);
            updateStatus("Download started!");
            // Clean up the object URL after download
            URL.revokeObjectURL(url);
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scrapingComplete") {
        reviewsReadyForDownload = true;
        document.getElementById('download').disabled = false;
        document.getElementById('scrape').disabled = true;
        document.getElementById('scrapeAll').disabled = true;
        updateStatus(`Scraping complete! ${message.count} reviews found.`);
    } else if (message.action === "updateStatus") {
        updateStatus(message.message);
    }
});

function updateStatus(message) {
    document.getElementById('status').textContent = message;
}