To run

python3 search.py

To merge:

jq -s 'add | unique_by(.id)' cases/*.json > merged_cases_2.json
