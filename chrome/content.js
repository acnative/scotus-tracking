let globalSearchResults = [];
let progressDiv = null;
/**
 * This content script uses fetch to simulate the ASPX POST requests.
 * When the page loads it first extracts the hidden ASP.NET form fields,
 * then sends a POST with your original search query parameters,
 * and paginates (using the "Next" button request parameters) until there 
 * are no more pages. All result pages’ fieldset texts are logged.
 */

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(min = 1000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Extracts initial hidden form values from the loaded page.
 */
function getInitialPageVars() {
    const viewstateInput = document.querySelector("input[name='__VIEWSTATE']");
    const viewstate = viewstateInput ? viewstateInput.value : "";

    const viewstateGenInput = document.querySelector("input[name='__VIEWSTATEGENERATOR']");
    const viewstateGenerator = viewstateGenInput ? viewstateGenInput.value : "";

    // If needed, extract additional fields (like __EVENTVALIDATION)
    return { viewstate, viewstateGenerator };
}

/**
 * Performs the initial search POST.
 * This uses the exact query parameters you captured.
 */
async function postInitialSearch(query, initialVars) {
    const body = new URLSearchParams();

    // Your original search query parameters:
    body.set("ctl00_ctl00_RadScriptManager1_TSM", "");
    body.set("ctl00$ctl00$txtSearch", "");
    body.set("ctl00$ctl00$txbhidden", "");
    body.set("ct", "Supreme-Court-Dockets");
    body.set("ctl00$ctl00$MainEditable$mainContent$txtQuery", query);
    body.set("ctl00$ctl00$MainEditable$mainContent$cmdSearch", "Search");
    body.set("__EVENTTARGET", "");
    body.set("__EVENTARGUMENT", "");
    body.set("__VIEWSTATE", initialVars.viewstate);
    body.set("__VIEWSTATEGENERATOR", initialVars.viewstateGenerator);

    const response = await fetch("https://www.supremecourt.gov/docket/docket.aspx", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "referrer": "https://www.supremecourt.gov/docket/docket.aspx"
        },
        body: body.toString(),
        credentials: "include"
    });
    return response.text();
}

/**
 * Performs the Next-page POST request.
 * It uses the updated __VIEWSTATE; note that __ASYNCPOST is set to true.
 */
async function postNextPage(viewstate, query, initialVars) {
    const body = new URLSearchParams();

    // Include the full RadScriptManager parameter as seen in the network call.
    body.set("ctl00$ctl00$RadScriptManager1", "ctl00$ctl00$MainEditable$mainContent$UpdatePanel1|ctl00$ctl00$MainEditable$mainContent$cmdNext");
    body.set("ctl00_ctl00_RadScriptManager1_TSM", "");
    body.set("__EVENTTARGET", "ctl00$ctl00$MainEditable$mainContent$cmdNext");
    body.set("__EVENTARGUMENT", "");
    // Include the search query and other parameters as required
    body.set("ctl00$ctl00$txtSearch", "");
    body.set("ctl00$ctl00$txbhidden", "");
    body.set("ct", "Supreme-Court-Dockets");
    body.set("ctl00$ctl00$MainEditable$mainContent$txtQuery", query);
    // Updated state and fixed generator
    body.set("__VIEWSTATE", viewstate);
    body.set("__VIEWSTATEGENERATOR", initialVars.viewstateGenerator);
    body.set("__ASYNCPOST", "true");

    const response = await fetch("https://www.supremecourt.gov/docket/docket.aspx", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "accept": "*/*",
            "x-microsoftajax": "Delta=true",
            "x-requested-with": "XMLHttpRequest",
            "referrer": "https://www.supremecourt.gov/docket/docket.aspx"
        },
        body: body.toString(),
        credentials: "include"
    });
    return response.text();
}

/**
 * Parses the returned HTML using DOMParser.
 * It extracts the result fieldset texts, the updated __VIEWSTATE,
 * and checks if the "Next" button is present.
 */
function parseDocketHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Gather all fieldsets that appear to be result blocks (start with "Docket for")
    const fieldsets = Array.from(doc.querySelectorAll("fieldset")).filter(fs =>
        fs.textContent.trim().startsWith("Docket for")
    );

    // Map each fieldset to an object with 'text' and 'href'
    const results = fieldsets.map(fs => {
        const anchor = fs.querySelector("a");
        const href = anchor ? anchor.getAttribute("href") : "";
        const docketMatch = anchor.innerText.match(/Docket for (.+?)(?=\s*\*|$)/i);
        const docketId = docketMatch ? docketMatch[1] : null;
        const docketInfo = extractDocketInfo(fs.querySelector("cc"));
        return { id: docketId, url: href, title: docketInfo.title, petitioner: docketInfo.petitioner, prevailing: docketInfo.prevailing };
    });

    // Get the new __VIEWSTATE value for the next post
    const viewstateInput = doc.querySelector("input[name='__VIEWSTATE']");
    const newViewstate = viewstateInput ? viewstateInput.value : "";

    // Check if a Next button is present:
    const nextButton = doc.querySelector("#ctl00_ctl00_MainEditable_mainContent_cmdNext");
    const hasNext = !!nextButton;

    return { results, newViewstate, hasNext };
}

/**
 * Runs a full ASPX search for a given query:
 *  • Uses initial form variables from the page.
 *  • Posts the initial search.
 *  • Then iteratively posts "Next" requests until no further paging is possible.
 */
async function runAspxSearch(query, queryIndex, totalQueries) {
    let pageCount = 1;
    updateProgress(queryIndex, totalQueries, pageCount);
    console.log(`\nRunning search for: ${query}`);
    const initialVars = getInitialPageVars();

    // Initial search POST using your current query parameters
    let html = await postInitialSearch(query, initialVars);
    let { results, newViewstate, hasNext } = parseDocketHtml(html);
    console.log(`Page 1 results for "${query}":`, results);
    let processedResults = await processSearchResults(results);
    console.log("Processed results:", processedResults);

    let lastHTML = html;

    // Pagination loop – continue if the "Next" button is present
    while (true && pageCount === 1) {
        await sleep(randomDelay());
        const nextHtml = await postNextPage(newViewstate, query, initialVars);

        // If the page hasn't changed, break out of the loop.
        if (!nextHtml || nextHtml === lastHTML) {
            console.log("No more pages or content unchanged. Ending pagination.");
            break;
        }

        let parseObj = parseDocketHtml(nextHtml);
        pageCount++;
        updateProgress(queryIndex, totalQueries, pageCount);
        console.log(`Page ${pageCount} results for "${query}":`, parseObj.results);
        const processedNextPageResults = await processSearchResults(parseObj.results);
        console.log("Processed next page results:", processedNextPageResults);

        processedResults = processedResults.concat(processedNextPageResults);
        lastHTML = nextHtml;
        newViewstate = parseObj.newViewstate;

        if (!parseObj.hasNext) {
            console.log("Next button not found. Ending pagination.");
            break;
        }
    }
    return processedResults;
}

/**
 * Main routine: iterate over your queries (for example, by year and month)
 * and run the ASPX search for each.
 */

function getRecentMonths() {
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const now = new Date();
    let currentMonthIndex = now.getMonth();
    let currentYear = now.getFullYear();
    const recent = [];

    for (let i = 0; i < 1; i++) {
        let monthIndex = currentMonthIndex - i;
        let year = currentYear;
        if (monthIndex < 0) {
            monthIndex += 12;
            year -= 1;
        }
        recent.push(`"capital case" "${monthNames[monthIndex]}" ${year}`);
    }
    return recent;
}


async function runAllQueries() {
    const queries = getRecentMonths();

    const totalQueries = queries.length;
    for (const [idx, q] of queries.entries()) {
        updateProgress(idx + 1, totalQueries, 1); // Reset page number for new query.
        console.log(`\n[${idx + 1}/${totalQueries}] Running query: ${q}`);
        // Pass the additional parameters so they are defined in runAspxSearch.
        const results = await runAspxSearch(`"capital case" "2025" January`, idx + 1, totalQueries);
        globalSearchResults = globalSearchResults.concat(results);
    }

    console.log("All queries complete!");
    console.log("Global search results:", globalSearchResults);
    downloadCSV();
    if (progressDiv) {
        progressDiv.textContent = "Downloaded CSV";
    }
}

/**
 * Given a result string (like "Docket for 16-5909Title: ..."), extracts the docket id.
 * Adjust the regex if the pattern changes.
 */
function extractDocketInfo(titleHTML) {
    console.log(titleHTML);

    let title = "";
    let petitioner = "";
    let prevailing = "";

    title = titleHTML.innerText
        .replace(/<[^>]+>/g, "")        // Remove any HTML tags
        .replace("Title:", "")
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Now split the cleaned title using the "v" (or "v.") delimiter.
    petitioner = title;
    const splitParts = title.split(" v. ");
    if (splitParts.length >= 2) {
        petitioner = splitParts[0].trim();
        prevailing = splitParts[1].trim();
    }

    console.log(title, petitioner, prevailing);
    return { title, petitioner, prevailing };

}

async function processSearchResults(results) {
    // Process each search result sequentially
    const processed = [];
    console.log(results.length);
    for (const result of results) {
        if (result.id) {
            console.log("Processing docket:", result.id);
            try {
                // Await the entries returned from the iframe
                const entries = await processDocketIframe(result.url);
                // Append entries to the result map
                result.entries = entries;
            } catch (err) {
                console.error("Error processing docket:", result.id, err);
                result.entries = [];
            }
            processed.push(result);
        } else {
            console.warn("Could not extract docket from:", result);
        }
    }
    return processed;
}

/**
 * Extracts docket entries from a given document.
 * This function mimics the extraction logic for proceedings/orders—
 * first by checking if a proceedings table exists, and if not, using a fallback method.
 */
function extractDocketDetailsFromDoc(doc) {
    const entries = [];

    // Method 1: Extract from a proceedings table with id="proceedings"
    const table = doc.getElementById("proceedings");
    console.log("Proceedings table:", doc);
    if (table) {
        // Get all rows except the header row
        const rows = Array.from(table.querySelectorAll("tr")).slice(1);
        rows.forEach(row => {
            const cells = row.querySelectorAll("td");
            if (cells.length >= 2) {
                const date = cells[0].innerText.trim();
                const detail = cells[1].innerText.trim();
                // Only push rows where a valid date was found
                if (date !== "" && detail !== "") {
                    entries.push({ date, detail });
                }
            }
        });
        if (entries.length > 0) {
            return entries;
        }
    }
    else {
        // Fallback: Extract from text between "~~~Date~~~" and first <hr>
        const pageHTML = doc.body.innerHTML;
        let startIndex = pageHTML.indexOf("~~~Date~~~");
        if (startIndex !== -1) {
            let endIndex = pageHTML.indexOf("<hr", startIndex);
            if (endIndex === -1) {
                endIndex = pageHTML.length;
            }
            const tableText = pageHTML.substring(startIndex, endIndex);
            // Split into lines and remove HTML tags
            const rawLines = tableText.split(/\r?\n/);
            const lines = rawLines
                .map(line => line.replace(/<[^>]*>/g, "").trim())
                .filter(line => line.length > 0);
            // Remove header row if present
            if (lines.length && lines[0].includes("~~~Date~~~")) {
                lines.shift();
            }
            // Pair every two lines as date and detail
            for (let i = 0; i < lines.length; i += 2) {
                if (i + 1 < lines.length) {
                    entries.push({ date: lines[i], detail: lines[i + 1] });
                }
            }
        }
    }
    return entries;
}

function processDocketIframe(url) {
    return new Promise((resolve, reject) => {
        console.log("Processing docket iframe for URL:", url);
        const iframe = document.createElement("iframe");
        iframe.style.display = "none"; // hide the iframe
        iframe.src = url;
        document.body.appendChild(iframe);

        iframe.onload = function () {
            // Access the contentDocument of the iframe
            console.log("Iframe loaded for URL:", url);
            const doc = iframe.contentDocument || iframe.contentWindow.document;
            const entries = extractDocketDetailsFromDoc(doc);
            console.log("Extracted entries:", entries);
            document.body.removeChild(iframe);
            resolve(entries);
        };

        iframe.onerror = function () {
            console.error("Error loading iframe for URL:", url);
            document.body.removeChild(iframe);
            reject(new Error("Failed to load iframe for URL: " + url));
        };
    });
}

function convertResultsToCSV(data) {
    if (!data || data.length === 0) {
        return "";
    }

    // Define header fields for the CSV file.
    const headerFields = ["id", "title", "petitioner", "prevailing", "date", "detail", "url"];
    let csv = headerFields.join(",") + "\n";

    // Define which fields come from the parent result.
    const parentKeys = headerFields.filter(key => key !== "date" && key !== "detail");

    data.forEach(result => {
        if (Array.isArray(result.entries) && result.entries.length > 0) {
            result.entries.forEach(entry => {
                // Build a row by looping over headerFields.
                let row = headerFields.map(field => {
                    let value = "";
                    if (parentKeys.includes(field)) {
                        // Get the parent's field value.
                        value = result[field] || "";
                    } else {
                        // For entry-specific fields
                        value = entry[field] || "";
                    }
                    // Escape quotes and wrap the field in quotes.
                    return `"${(value + "").replace(/"/g, '""')}"`;
                });
                csv += row.join(",") + "\n";
            });
        } else {
            // If no entries, output a row with parent's keys and empty for entries.
            let row = headerFields.map(field => {
                let value = parentKeys.includes(field) ? (result[field] || "") : "";
                return `"${(value + "").replace(/"/g, '""')}"`;
            });
            csv += row.join(",") + "\n";
        }
    });

    return csv;
}
/**
 * Triggers a download of the CSV file for the globalSearchResults.
 */
function downloadCSV() {
    const csvContent = convertResultsToCSV(globalSearchResults);
    if (!csvContent) {
        console.warn("No search results to download.");
        return;
    }

    // Create a Blob from the CSV string.
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    // Create a temporary URL for this Blob.
    const url = URL.createObjectURL(blob);

    // Create a temporary, hidden anchor element.
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = "scotus_details.csv";

    // Append the anchor, click it to start the download, then remove it.
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Optionally, revoke the object URL after a short delay.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Updates the progress UI.
 * @param {number} queryIndex - The current query index (starting at 1).
 * @param {number} totalQueries - Total queries to run.
 * @param {number} page - The current page number of the current query.
 */
function updateProgress(queryIndex, totalQueries, page) {
    progressDiv.textContent = `Query ${queryIndex} of ${totalQueries} - Page ${page}`;
}

// Create and style the progress element and add it to the page.
function initProgressDiv() {
    progressDiv = document.createElement('div');
    progressDiv.style.position = 'fixed';
    progressDiv.style.bottom = '0';
    progressDiv.style.right = '0';
    progressDiv.style.padding = '5px';
    progressDiv.style.backgroundColor = 'yellow';
    progressDiv.style.zIndex = '10000';
    progressDiv.style.fontSize = '14px';
    progressDiv.style.fontFamily = 'sans-serif';
    progressDiv.style.textAlign = 'right';
    document.body.appendChild(progressDiv);
}

// Kick off the process when this content script loads.
if (window.location.href === "https://www.supremecourt.gov/docket/docket.aspx") {
    initProgressDiv();
    runAllQueries();
}