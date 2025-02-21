from helium import start_chrome, kill_browser, get_driver
import json
import time
import re

def launch_browser(url, headless=False):
    """Launches Chrome with a given URL."""
    browser = start_chrome(url, headless=headless)
    time.sleep(2)  # Wait for the page to load
    return browser

def extract_entries_from_text(page_text):
    """
    Extracts table entries from the page text.
    Starts at the first occurrence of "~~~Date~~~" and stops at the first <hr tag.
    Removes HTML tags and empty string values.
    Assumes that after the header row, every two consecutive non-empty lines represent:
      - first line: date
      - second line: detail
    Returns a list of dictionaries with 'date' and 'detail' keys.
    """
    start_index = page_text.find("~~~Date~~~")
    if start_index == -1:
        print("Header not found in page text.")
        return []
    end_index = page_text.find("<hr", start_index)
    if end_index == -1:
        end_index = len(page_text)
    table_text = page_text[start_index:end_index]
    
    # Split into lines, remove HTML tags and trim, then filter out empty ones
    raw_lines = table_text.splitlines()
    lines = []
    for line in raw_lines:
        clean_line = re.sub(r'<[^>]*>', '', line).strip()
        if clean_line:
            lines.append(clean_line)
    
    # Remove header row. Assumes the header starts with "~~~Date~~~"
    if lines and lines[0].startswith("~~~Date~~~"):
        lines = lines[1:]
    
    entries = []
    # Pair lines (first is date, second is detail)
    for i in range(0, len(lines), 2):
        if i + 1 < len(lines):
            date_line = lines[i]
            detail_line = lines[i+1]
            if date_line and detail_line:
                entries.append({
                    "date": date_line,
                    "detail": detail_line,
                })
    print(entries)
    return entries

def enrich_cases():
    """
    1. Loads JSON objects from merged_cases.json.
    2. Iterates through each case using its id to navigate to the detail page.
       The id is trimmed up to the first space.
    3. Extracts the table text between the "~~~Date~~~" header and the <hr> tag.
    4. Parses the table lines into {'date', 'detail'} pairs and appends as "entries" to the case.
    5. Saves all enriched cases into enriched_cases.json after each case is processed.
    """
    with open("merged_cases.json", "r") as f:
        cases = json.load(f)
    
    enriched = []    
    case_counter = 0
    total_cases = len(cases)
    for index, case in enumerate(cases, start=1):
        docket = case.get("id", "").split()[0]  # trim anything after a space
        print(f"Processing case {index} of {total_cases} (Remaining: {total_cases - index})")
        url = f"https://www.supremecourt.gov/search.aspx?filename=/docketfiles/{docket}.htm"
        print(f"Fetching details for docket {docket} from {url}")
        
        # Launch a new browser for this case
        launch_browser(url)
        # Get the full page text (HTML source)
        page_text = get_driver().page_source
        entries = extract_entries_from_text(page_text)
        print(f"Found {len(entries)} entries for docket {docket}")
        case["entries"] = entries
        case["id"] = docket
        
        enriched.append(case)
        kill_browser()
        case_counter += 1
        
        # Save enriched results to file after processing each case.
        with open("enriched_cases.json", "w") as wf:
            json.dump(enriched, wf, indent=2)
        print(f"Saved {case_counter} enriched cases to enriched_cases.json")
        time.sleep(1)  # Pause before processing next case

if __name__ == "__main__":
    enrich_cases()