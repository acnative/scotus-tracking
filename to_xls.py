import sys
import os
import json
import pandas as pd

if len(sys.argv) < 2:
    print("Usage: python to_xls.py <input_json_path>")
    sys.exit(1)

input_path = sys.argv[1]
output_path = os.path.splitext(input_path)[0] + ".xlsx"

# Load your JSON data (assuming it's a list of dictionaries)
with open(input_path, "r") as f:
    data = json.load(f)

# Normalize nested JSON: create a row for each entry, duplicating the parent fields
df = pd.json_normalize(
    data,
    record_path='entries',
    meta=['id', 'title', 'petitioner', 'prevailing', 'additional']
)

# Write the resulting DataFrame to an Excel file
df.to_excel(output_path, index=False)
print(f"Excel file written to {output_path}")