import json
import sys

def extract_ids(file_path):
    """Reads a JSON file and extracts the set of 'id' values."""
    with open(file_path, 'r') as file:
        data = json.load(file)
    return {item['id'].split()[0] for item in data}

def compare_files(file1, file2):
    """
    Compares the 'id's from two JSON files.
    
    Returns:
        common: IDs present in both files.
        only_in_file1: IDs only in file1.
        only_in_file2: IDs only in file2.
    """
    ids1 = extract_ids(file1)
    ids2 = extract_ids(file2)

    common = ids1 & ids2  # Intersection
    only_in_file1 = ids1 - ids2
    only_in_file2 = ids2 - ids1

    return common, only_in_file1, only_in_file2

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python compare.py <file1.json> <file2.json>")
        sys.exit(1)

    file1 = sys.argv[1]
    file2 = sys.argv[2]

    common, only_in_file1, only_in_file2 = compare_files(file1, file2)

    print("\nIDs only in", file1, ":")
    print(only_in_file1)
    
    print("\nIDs only in", file2, ":")
    print(only_in_file2)