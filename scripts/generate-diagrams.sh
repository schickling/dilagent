#!/bin/bash

# Generate SVGs from Mermaid files
# Usage: ./scripts/generate-diagrams.sh

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Generating SVG diagrams from Mermaid files...${NC}"

# Check if diagrams directory exists
if [ ! -d "diagrams" ]; then
    echo -e "${RED}❌ diagrams/ directory not found${NC}"
    exit 1
fi

# Find all .mmd files in diagrams directory
mmd_files=$(find diagrams -name "*.mmd" -type f)

if [ -z "$mmd_files" ]; then
    echo -e "${RED}❌ No .mmd files found in diagrams/ directory${NC}"
    exit 1
fi

# Generate SVG for each Mermaid file
for mmd_file in $mmd_files; do
    # Get base filename without extension
    base_name=$(basename "$mmd_file" .mmd)
    svg_file="diagrams/${base_name}.svg"
    
    echo -e "${BLUE}📊 Processing: ${mmd_file}${NC}"
    
    # Generate SVG using Mermaid CLI
    if bunx @mermaid-js/mermaid-cli -i "$mmd_file" -o "$svg_file"; then
        echo -e "${GREEN}✅ Generated: ${svg_file}${NC}"
    else
        echo -e "${RED}❌ Failed to generate: ${svg_file}${NC}"
        exit 1
    fi
done

echo -e "${GREEN}🎉 All diagrams generated successfully!${NC}"