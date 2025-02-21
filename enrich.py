import re
import json
import time
import math
from helium import start_chrome, kill_browser, get_driver
from multiprocessing import Process

def launch_browser(url, headless=False):
    """Launches Chrome with a given URL."""
    browser = start_chrome(url, headless=headless)
    time.sleep(2)  # Wait for the page to load
    return browser

def extract_entries_from_text(page_text):
    """
    Extracts table entries from the page text for the first page variation.
    Starts at the first occurrence of "~~~Date~~~" and stops at the first <hr tag.
    Removes HTML tags and empty string values.
    Pairs every two non-empty lines (after header) as date and detail.
    Returns a list of dictionaries with 'date' and 'detail' keys.
    """
    start_index = page_text.find("~~~Date~~~")
    if start_index == -1:
        #print("Header not found in page text.")
        return []
    end_index = page_text.find("<hr", start_index)
    if end_index == -1:
        end_index = len(page_text)
    table_text = page_text[start_index:end_index]
    
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
    for i in range(0, len(lines), 2):
        if i + 1 < len(lines):
            date_line = lines[i]
            detail_line = lines[i+1]
            if date_line and detail_line:
                entries.append({
                    "date": date_line,
                    "detail": detail_line,
                })
    return entries

def extract_entries_from_proceedings_table(page_text):
    """
    Extracts table entries from pages that have a proceedings table.
    Looks for <table id="proceedings">, extracts each row (skipping the header),
    then removes HTML tags from the cells and returns a list of dictionaries.
    """
    if 'id="proceedings"' not in page_text:
        return []
    start = page_text.find('<table id="proceedings"')
    end = page_text.find('</table>', start)
    if end == -1:
        end = len(page_text)
    table_html = page_text[start:end]
    # Grab all rows inside the table
    rows = re.findall(r'<tr>(.*?)</tr>', table_html, re.DOTALL)
    entries = []
    # Skip the header row
    for row in rows[1:]:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        cleaned = [re.sub(r'<[^>]+>', '', cell).strip() for cell in cells]
        if len(cleaned) >= 2 and cleaned[0] and cleaned[1]:
            entries.append({
                "date": cleaned[0],
                "detail": cleaned[1]
            })
    return entries

def process_group(group_id, group_cases):
    """
    Processes a list of cases (group_cases) belonging to one group.
    Each case is processed by launching a browser to fetch its detail page.
    For each case, tries first to extract entries from proceedings table (if present);
    otherwise falls back to the original extraction method.
    Writes the enriched cases to enriched_cases_group_{group_id}.json.
    """
    enriched = []
    total_in_group = len(group_cases)
    for idx, case in enumerate(group_cases, start=1):
        docket = case.get("id", "").split()[0]  # Trim anything after a space
        remaining = total_in_group - idx
        print(f"[Group {group_id}] Processing case {idx} of {total_in_group} (Remaining: {remaining})")
        url = f"https://www.supremecourt.gov/search.aspx?filename=/docketfiles/{docket}.htm"
        print(f"[Group {group_id}] Fetching details for docket {docket} from {url}")

        launch_browser(url)
        page_text = get_driver().page_source
        
        # Choose extraction method depending on the page type.
        if 'id="proceedings"' in page_text:
            entries = extract_entries_from_proceedings_table(page_text)
        else:
            entries = extract_entries_from_text(page_text)

        # Try alternate URL if no entries were found.
        if not entries:
            alt_url = f"https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/{docket}.html"
            print(f"[Group {group_id}] No entries found. Retrying with alternate URL: {alt_url}")
            kill_browser()
            launch_browser(alt_url)
            page_text = get_driver().page_source
            if 'id="proceedings"' in page_text:
                entries = extract_entries_from_proceedings_table(page_text)
            else:
                entries = extract_entries_from_text(page_text)

        print(f"[Group {group_id}] FINAL: Found {len(entries)} entries for docket {docket}")
        case["entries"] = entries
        case["id"] = docket
        enriched.append(case)
        kill_browser()
        time.sleep(1)
        
        # Write current group progress to file
        with open(f"enriched_cases_group_{group_id}.json", "w") as wf:
            json.dump(enriched, wf, indent=2)
        print(f"[Group {group_id}] Saved {idx} enriched cases to enriched_cases_group_{group_id}.json")
    print(f"[Group {group_id}] Completed processing group with {total_in_group} cases.")

def enrich_cases():
    """
    Loads merged_cases.json, splits the cases into 10 groups, and processes each group in parallel.
    Each group writes its enriched cases to its own JSON file.
    """
    with open("merged_cases.json", "r") as f:
        cases = json.load(f)

    #allowed_ids = {'21A612', '21A678', '21A774', '21A705', '18-8753', '21A752', '21A67', '18-8723', '21A672', '21A632', '21A676', '21A637', '21A787'}
    #cases = list(filter(lambda x: any(substr in x.get("id", "") for substr in allowed_ids), cases))
        
    total_cases = len(cases)
    n_groups = 12
    group_size = math.ceil(total_cases / n_groups)
    groups = [cases[i*group_size:(i+1)*group_size] for i in range(n_groups)]
    
    processes = []
    for group_id, group_cases in enumerate(groups, start=1):
        if not group_cases:
            continue
        p = Process(target=process_group, args=(group_id, group_cases))
        p.start()
        processes.append(p)
    
    for p in processes:
        p.join()
    
    print("All groups have been processed.")

if __name__ == "__main__":
    enrich_cases()