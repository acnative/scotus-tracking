from helium import (start_chrome, kill_browser, click, find_all, Text, S, write, 
                   wait_until, Button, get_driver)

import csv
import time
import os
import json
import re

def launch_browser(path="https://www.supremecourt.gov/docket/docket.aspx", headless=False):
    """Launches Chrome and initiates search."""
    browser = start_chrome(path, 
                         headless=headless)
    time.sleep(2)  # Wait for results
    return browser

def parse_result(result_text):
    """
    Given result_text from a fieldset, extracts:
      - id: docket number from the line starting with "Docket for"
      - title: the text after "Title:"
      - petitioner: text before "v" (or "vs" variants) in title
      - prevailing: text after "v" (or "vs" variants) in title
      - additional: any additional info from subsequent lines
    """

    # Split result_text into non-empty lines
    lines = [line.strip() for line in result_text.splitlines() if line.strip()]
    
    docket_id = "Unknown"
    title_line = ""
    additional = ""
    
    # Extract docket id from first line
    if lines and lines[0].lower().startswith("docket for"):
        docket_id = lines[0][len("Docket for"):].strip()
    
    # Extract title from second line
    if len(lines) > 1 and lines[1].lower().startswith("title:"):
        title_line = lines[1][len("Title:"):].strip()
    
    # Use third line as additional info if available
    if len(lines) > 2:
        additional = lines[2]
    
    # Split title_line by 'v.' (case-insensitive) to separate petitioner and prevailing
    split_title = re.split(r'\s*v\.\s*', title_line, flags=re.IGNORECASE)
    petitioner = split_title[0] if split_title else ""
    prevailing = split_title[1] if len(split_title) > 1 else ""
    
    return {
        "id": docket_id,
        "title": title_line,
        "petitioner": petitioner,
        "prevailing": prevailing,
        "additional": additional
    }

def sanitize_filename(query):
    # Remove quotes and spaces; replace spaces with underscores.
    filename = query.replace('"', '').replace("'", "")
    filename = re.sub(r'\s+', '_', filename)
    return filename

def run_advanced_search(query):
    """
    Runs an advanced search using the given query, prints page info and all results.
    Assumes the search input and button have the following ids:
      - Search input: ctl00_ctl00_MainEditable_mainContent_txtSearch
      - Search button: ctl00_ctl00_MainEditable_mainContent_cmdSearch
    """
    try:
        # Enter search text
        search_field = S("#ctl00_ctl00_MainEditable_mainContent_txtQuery")
        if not search_field.exists():
            raise Exception("Search field not found")
        write(query, into=search_field)
        
        # Click search button
        search_btn = S("#ctl00_ctl00_MainEditable_mainContent_cmdSearch")
        if not search_btn.exists():
            raise Exception("Search button not found")
        click(search_btn)
        time.sleep(2)
        
        all_results = []
        json_results = []
        current_page = 1
        last_page_info = None
        
        while True:
            # Wait for update panel to load
            wait_until(S("#ctl00_ctl00_MainEditable_mainContent_UpdatePanel1").exists)
            time.sleep(2)
            
            # Get and print page info
            page_info_element = S("#ctl00_ctl00_MainEditable_mainContent_lblCurrentPage")
            page_info = page_info_element.web_element.text if page_info_element.exists() else "No page info"
            print(f"Page {current_page} info: {page_info}")
            
            # If page info is unchanged from the last page, assume this is the final page and exit.
            if last_page_info == page_info:
                print("Page info unchanged. Terminating search.")
                break
            last_page_info = page_info

            # Get all fieldset elements inside update panel (each result result is in a fieldset)
            result_fieldsets = find_all(S("#ctl00_ctl00_MainEditable_mainContent_UpdatePanel1 fieldset"))
            for fs in result_fieldsets:
                # Skip header fieldset that just displays 'Search Results:'
                if "Search Results:" in fs.web_element.text:
                    continue
                result_text = fs.web_element.text.strip()
                print(f"Result: {result_text}")
                all_results.append(result_text)

                parsed = parse_result(result_text)
                print("Parsed Result:", json.dumps(parsed))
                json_results.append(parsed)

            # Save all parsed results to a JSON file named after the query.
            filename = sanitize_filename(query) + ".json"
            with open(filename, "w") as f:
                json.dump(json_results, f, indent=2)
            print(f"Saved results to {filename}")
            
            # Check for next button
            next_btn = S("#ctl00_ctl00_MainEditable_mainContent_cmdNext")
            if next_btn.exists():
                print("Clicking on next page...")
                click(next_btn)
                current_page += 1
                time.sleep(2)
            else:
                print("No next page button found. Terminating search.")
                break
        
        print("All results retrieved:")
        for res in all_results:
            print(res)
            
    except Exception as e:
        print(f"Error during search: {e}")

def run_search_for_query(query):
    browser = launch_browser()
    run_advanced_search(query)
    kill_browser()

if __name__ == "__main__":
    from multiprocessing import Process
    import sys

    # List of month names
    months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ]

    # Iterate over each year from 2013 through 2025
    for year in range(2013, 2026):
        print(f"Starting searches for year: {year}")
        
        processes = []
        for month in months:
            query = f'"capital case" "{year}" {month}'
            p = Process(target=run_search_for_query, args=(query,))
            p.start()
            processes.append(p)
        
        # Wait for all month processes in this year to complete
        for p in processes:
            p.join()
        
        print(f"Completed all month queries for year {year}")