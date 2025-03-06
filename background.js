chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startScraping") {
        const productPageUrl = message.url;
        let reviewsUrl = "";

        // Construct the reviews URL (Flipkart).
        if (productPageUrl.includes("flipkart")) {
            reviewsUrl = productPageUrl.replace('/p/', '/product-reviews/');
            reviewsUrl = reviewsUrl + "&page=1";
        }

        // Construct the reviews URL (Amazon).
        else if (productPageUrl.includes("amazon.in")) {
            // Extract the product ID (ASIN) using a more robust regex.
            let match = productPageUrl.match(/\/dp\/([A-Z0-9]+)/);  // Corrected regex
            if (!match) {
                match = productPageUrl.match(/\/gp\/product\/([A-Z0-9]+)/);
            }
            if (match && match[1]) {
                const asin = match[1];
                reviewsUrl = `https://www.amazon.in/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm?ie=UTF8&reviewerType=all_reviews&pageNumber=1`; // Directly construct the URL
            }
            else {
                chrome.runtime.sendMessage({ action: "updateStatus", message: "Invalid Amazon URL" });
                return;
            }
        }

        scrapePage(reviewsUrl, message.tabId, []);
    } else if (message.action === "startScrapingAll") {
        scrapeAllProducts(message.url, message.tabId);
    }
});

async function scrapeAllProducts(searchUrl, tabId) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: scrapeSearchResults,
        args: [searchUrl]
    }, (result) => {
        if (chrome.runtime.lastError || !result || !result[0] || !result[0].result) {
            console.error("Scraping search results failed:", chrome.runtime.lastError);
            chrome.runtime.sendMessage({ action: "updateStatus", message: "Failed to scrape search results." });
            return;
        }

        const productUrls = result[0].result;
        if (productUrls.length === 0) {
            chrome.runtime.sendMessage({ action: "updateStatus", message: "No products found on the search results page." });
            return;
        }

        let allReviews = [];
        let completed = 0;

        productUrls.forEach(productUrl => {
            let reviewsUrl;
            if (searchUrl.includes('flipkart')) {
                reviewsUrl = productUrl.replace('/p/', '/product-reviews/') + "&page=1";
            } else if (searchUrl.includes('amazon.in')) {
                let asinMatch = productUrl.match(/\/dp\/([A-Z0-9]+)/);
                if (asinMatch && asinMatch[1]) {
                    const asin = asinMatch[1];
                    reviewsUrl = `https://www.amazon.in/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm?ie=UTF8&reviewerType=all_reviews&pageNumber=1`;
                }
            }

            if (reviewsUrl) {
                scrapePage(reviewsUrl, tabId, [], (reviews) => {
                    allReviews = allReviews.concat(reviews);
                    completed++;
                    if (completed === productUrls.length) {
                        chrome.storage.local.set({ reviews: allReviews }, () => {
                            chrome.runtime.sendMessage({ action: "scrapingComplete", count: allReviews.length });
                        });
                    }
                });
            }
        });
    });
}

async function scrapePage(url, tabId, allReviews, callback) {
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: scrapePageContent,
        args: [url]
    }, (result) => {

        if (chrome.runtime.lastError || !result || !result[0] || !result[0].result) {
            console.error("Scraping failed:", chrome.runtime.lastError);
            // Store whatever we have, even on error.
            chrome.storage.local.set({ reviews: allReviews }, () => {
                chrome.runtime.sendMessage({ action: "scrapingComplete", count: allReviews.length });
            });
            return;
        }
        const pageReviews = result[0].result;

        if (pageReviews && pageReviews.reviewsData.length > 0) {
            allReviews = allReviews.concat(pageReviews.reviewsData);

            // Construct the next page URL.  Works for both Flipkart and Amazon.
            let nextPageNum;
            let nextUrl;

            if (url.includes("flipkart.com")) {
                nextPageNum = parseInt(url.match(/&page=(\d+)/)[1]) + 1;
                nextUrl = url.replace(/&page=\d+/, `&page=${nextPageNum}`);
            }
            else if (url.includes("amazon")) {
                nextPageNum = parseInt(url.match(/pageNumber=(\d+)/)[1]) + 1;
                nextUrl = url.replace(/pageNumber=\d+/, `pageNumber=${nextPageNum}`);
            }

            // Add a delay (e.g., 1 second) to avoid rate limiting.  Essential!
            setTimeout(() => {
                scrapePage(nextUrl, tabId, allReviews, callback);
            }, 1200); // 1000 milliseconds = 1 second

        } else {
            // No more reviews.  Store the results.
            if (callback) {
                callback(allReviews);
            } else {
                chrome.storage.local.set({ reviews: allReviews }, () => {
                    chrome.runtime.sendMessage({ action: "scrapingComplete", count: allReviews.length });
                });
            }
        }
    });
}

function scrapeSearchResults(url) {
    return new Promise((resolve) => {
        fetch(url)
            .then(response => response.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                let productLinks = [];

                if (url.includes('flipkart')) {
                    productLinks = Array.from(doc.querySelectorAll('a.rPDeLR')).map(a => a.href);
                    if (!productLinks || productLinks.length === 0) {
                        productLinks = Array.from(doc.querySelectorAll('a.CGtC98')).map(a => a.href);
                    }
                } else if (url.includes('amazon.in')) {
                    let productElements = doc.querySelectorAll('a.a-link-normal.s-line-clamp-3.s-link-style.a-text-normal');
                    if(!productElements || productElements.length === 0){
                        productElements = doc.querySelectorAll('a.a-link-normal.s-line-clamp-2.s-link-style.a-text-normal')
                    }
                    productElements.forEach(element => {
                        const href = element.getAttribute('href');
                        if (href && href.includes('/dp/')) {
                            productLinks.push(`https://www.amazon.in${href}`);
                        }
                    });
                }
                
                resolve(productLinks);
            })
            .catch(error => {
                console.error("Error during fetch:", error);
                resolve([]);
            });
    });
}

function scrapePageContent(url) {
    return new Promise((resolve) => {
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok: ${response.status}`);
                }
                return response.text();
            })
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                let reviewsData = [];
                let productTitle = "";

                // --- Flipkart Scraping ---
                console.log(url);
                if (url.includes("flipkart.com")) {
                    // Directly get the product title
                    const titleElement = doc.querySelector('.Vu3-9u');
                    productTitle = titleElement ? titleElement.textContent.trim() : "Unknown Product";

                    // Corrected Container Selector:
                    const reviewContainers = doc.querySelectorAll('.col.EPCmJX.Ma1fCG');

                    reviewContainers.forEach(container => {
                        let textElement = container.querySelectorAll('.ZmyHeo > div > ._11pzQk');
                        if (textElement.length === 0) {
                            textElement = container.querySelectorAll('.ZmyHeo > div > div');
                        }
                        let demographicElements = container.querySelectorAll('.row.gHqwa8 > .MztJPv > span');
                        if(demographicElements.length === 0){
                            demographicElements = container.querySelectorAll('.row.gHqwa8 > .row > .MztJPv');
                        }

                        let postingTimeElement = container.querySelectorAll('.row.gHqwa8 > .row > ._2NsDsF');

                        let demographic = "Unknown";
                        if(demographicElements.length > 0){
                            let filteredDemographics = demographicElements[demographicElements.length-1].textContent.split(",");
                            console.log(filteredDemographics);
                            demographic = filteredDemographics[filteredDemographics.length-1];
                        }

                        let postingTime = "Unknown";
                        if (postingTimeElement.length > 1) {
                            postingTime = postingTimeElement[1].textContent;
                        }
                        
                        if(textElement.length > 0){ // Ensure textElement has content before accessing [0]
                            reviewsData.push({
                                productTitle,
                                text: textElement[0].textContent,
                                demographic: demographic,
                                posting_date: postingTime
                            });
                        }
                    });
                }
                // --- Amazon Scraping ---
                else if (url.includes("amazon.in")) { //Corrected to amazon.in
                    const titleElement = doc.querySelector('.a-size-large.a-text-ellipsis.product-info-title > a'); 
                    productTitle = titleElement ? titleElement.textContent : "Unknown Product";

                    const reviewElements = doc.querySelectorAll('.a-section.celwidget');

                    reviewElements.forEach(reviewElement => {
                        if(reviewElement.querySelector('.a-size-base.review-text.review-text-content > span') === null){
                            return;
                        }
                        const text = reviewElement.querySelector('.a-size-base.review-text.review-text-content > span').textContent;
                        const demographicData = reviewElement.querySelector('.a-size-base.a-color-secondary.review-date').textContent;

                        const demographic = demographicData.split(" ")[2];
                        const posting_date = demographicData.split("on")[1]; 
                        reviewsData.push({ productTitle, text:text, demographic:demographic, posting_date: posting_date });
                    });
                }

                resolve({ reviewsData });
            })
            .catch(error => {
                console.error("Error during fetch:", error);
                resolve({ reviewsData: [] }); // Resolve with empty array on error.
            });
    });
}