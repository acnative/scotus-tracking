import pandas as pd

# Load your JSON data (assuming it's a list of dictionaries)
df = pd.read_json("merged_cases.json")

# Optionally, you may need to normalize nested JSON structures:
# df = pd.json_normalize(your_json_data)

# Write to an Excel file
df.to_excel("output.xlsx", index=False)