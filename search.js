/**
 * Search and match logic for item inventory.
 * Supports:
 * 1. Simple substring matching (case-insensitive) on name/description and location.
 * 2. Chinese Pinyin & Initials Match via PinyinMatch library.
 * 3. Fuzzy string matching via Fuse.js.
 */

window.ItemSearch = {
  /**
   * Filters a list of items using PinyinMatch and Fuse.js fuzzy search.
   * Direct/Pinyin matches are ranked higher, followed by fuzzy matches.
   * @param {Array} items - All inventory items
   * @param {string} query - The search string
   * @returns {Array} Filtered and sorted items matching the query
   */
  filter(items, query) {
    if (!query) return items;
    
    const cleanQuery = query.trim().toLowerCase();
    if (cleanQuery === '') return items;

    // 1. Direct substring & PinyinMatch (High Relevance)
    const exactMatches = items.filter(item => {
      const name = (item.name || '').toLowerCase();
      const location = (item.location || '').toLowerCase();

      // Substring match
      if (name.includes(cleanQuery) || location.includes(cleanQuery)) {
        return true;
      }

      // Pinyin full & initials match
      if (typeof PinyinMatch !== 'undefined') {
        try {
          const matchName = PinyinMatch.match(item.name || '', query);
          if (matchName) return true;

          const matchLocation = PinyinMatch.match(item.location || '', query);
          if (matchLocation) return true;
        } catch (err) {
          console.error('PinyinMatch error:', err);
        }
      }

      return false;
    });

    // 2. Fuzzy Match via Fuse.js (Low Relevance/Tolerance)
    let fuzzyMatches = [];
    if (typeof Fuse !== 'undefined') {
      try {
        const fuse = new Fuse(items, {
          keys: [
            { name: 'name', weight: 0.7 },
            { name: 'location', weight: 0.3 }
          ],
          threshold: 0.4, // lower threshold is stricter, higher is looser
          distance: 100
        });
        
        fuzzyMatches = fuse.search(query).map(result => result.item);
      } catch (err) {
        console.error('Fuse.js error:', err);
      }
    }

    // 3. Combine results keeping exact/pinyin matches first (maintaining search rank)
    const combined = [...exactMatches];
    const seenIds = new Set(exactMatches.map(item => item.id));

    fuzzyMatches.forEach(item => {
      if (!seenIds.has(item.id)) {
        combined.push(item);
        seenIds.add(item.id);
      }
    });

    return combined;
  }
};