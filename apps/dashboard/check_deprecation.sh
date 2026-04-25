packages=($(cat /Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/package.json /Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/api/package.json /Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/worker/package.json /Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/shared/package.json /Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/web/package.json /Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/package.json /Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/server/package.json | jq -r '(.dependencies // {}), (.devDependencies // {}) | keys[]' | sort -u))

for pkg in "${packages[@]}"; do
  # Skip local packages if identifiable, but here we check all
  dep=$(npm info "$pkg" deprecation 2>/dev/null)
  if [[ -n "$dep" ]]; then
    echo "$pkg: $dep"
  fi
done
