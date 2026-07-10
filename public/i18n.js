/**
 * Lightweight English -> Nepali translation layer.
 *
 * The whole UI is authored in English. This engine keeps that as the source and,
 * whenever the user selects नेपाली, walks the rendered DOM after each screen render
 * and swaps known English phrases for Nepali (from the dictionary below). It caches
 * each node's original English so switching back to English is instant.
 *
 * To translate more text later: just add "English": "नेपाली" pairs to NE.
 */
(function () {
  // English -> Nepali dictionary. Longer phrases are matched before shorter ones.
  const NE = {
    // ---- brand / generic ----
    'Your Smart Farming Partner': 'तपाईंको स्मार्ट कृषि साथी',
    'Loading…': 'लोड हुँदै…',
    'Back': 'पछाडि',
    'Save': 'सुरक्षित गर्नुहोस्',
    'Save changes': 'परिवर्तन सुरक्षित गर्नुहोस्',
    'Cancel': 'रद्द गर्नुहोस्',
    'Delete': 'मेटाउनुहोस्',
    'Update': 'अपडेट',
    'Logout': 'लगआउट',
    'Send': 'पठाउनुहोस्',
    'Nothing to update': 'अपडेट गर्न केही छैन',

    // ---- auth ----
    'Login': 'लगइन',
    'Register': 'दर्ता गर्नुहोस्',
    'Create account': 'खाता बनाउनुहोस्',
    'New here?': 'नयाँ हुनुहुन्छ?',
    'Have an account?': 'खाता छ?',
    'Phone or Email': 'फोन वा इमेल',
    'Password': 'पासवर्ड',
    'Full name': 'पूरा नाम',
    'Phone': 'फोन',
    'Email (optional)': 'इमेल (वैकल्पिक)',
    'Demo logins': 'डेमो लगइन',
    'Farmer': 'किसान',
    'Agriculture Expert': 'कृषि विशेषज्ञ',
    'Select your Ward (Taplejung)': 'आफ्नो वडा छान्नुहोस् (ताप्लेजुङ)',
    'Ward No.': 'वडा नं.',
    'Please select your Ward (1–11).': 'कृपया आफ्नो वडा (१–११) छान्नुहोस्।',

    // ---- bottom nav ----
    'Home': 'गृह',
    'My Crops': 'मेरो बाली',
    'Bazar': 'बजार',
    'Expert': 'विशेषज्ञ',
    'Alerts': 'सूचनाहरू',
    'Dashboard': 'ड्यासबोर्ड',
    'Experts': 'विशेषज्ञहरू',
    'Market': 'बजार भाउ',
    'Users': 'प्रयोगकर्ताहरू',
    'Questions': 'प्रश्नहरू',
    'Profile': 'प्रोफाइल',

    // ---- home cards ----
    'Weather': 'मौसम',
    'Temp, rain & alerts': 'तापक्रम, वर्षा र सूचना',
    'Farm Update': 'कृषि अपडेट',
    'News & schemes': 'समाचार र योजनाहरू',
    'Market Price': 'बजार भाउ',
    'Daily rates': 'दैनिक भाउ',
    'Sales': 'बिक्री',
    'Track monthly sales': 'मासिक बिक्री हेर्नुहोस्',
    'Expenses': 'खर्च',
    'Wages, seed, fertilizer…': 'ज्याला, बीउ, मल…',
    'Contact Expert': 'विशेषज्ञलाई सम्पर्क',
    'Get solutions': 'समाधान पाउनुहोस्',
    'Chat with AI': 'एआईसँग कुरा गर्नुहोस्',
    'Instant farming help': 'तुरुन्त कृषि सहयोग',
    'Buy & sell local products': 'स्थानीय सामान किनबेच',
    'AI Disease Detection': 'एआई रोग पहिचान',
    'Photograph a plant and get a diagnosis.': 'बिरुवाको फोटो खिचेर रोग पत्ता लगाउनुहोस्।',
    'Open Detector': 'डिटेक्टर खोल्नुहोस्',

    // ---- crops / fields ----
    'My Fields': 'मेरा खेतहरू',
    'Add Field': 'खेत थप्नुहोस्',
    'Add Crop': 'बाली थप्नुहोस्',
    'Save Crop': 'बाली सुरक्षित गर्नुहोस्',
    'Field name': 'खेतको नाम',
    'Location': 'स्थान',
    'Latitude': 'अक्षांश',
    'Longitude': 'देशान्तर',
    'Size': 'क्षेत्रफल',
    'Soil type': 'माटोको प्रकार',
    'Category': 'वर्ग',
    'Crop name': 'बालीको नाम',
    'Plant / animal count': 'बिरुवा/पशु संख्या',
    'Growth stage': 'वृद्धि अवस्था',
    'Growth Stage': 'वृद्धि अवस्था',
    'Watering schedule': 'सिँचाइ तालिका',
    'Watering': 'सिँचाइ',
    'Fertilizer used': 'प्रयोग गरिएको मल',
    'Fertilizer': 'मल',
    'Planted': 'रोपेको',
    'Harvest': 'बाली भित्र्याउने',
    'Status': 'अवस्था',
    'Healthy': 'स्वस्थ',
    'Diseased': 'रोगी',
    'At Risk': 'जोखिममा',
    'Disease History': 'रोगको इतिहास',
    'Notes': 'टिप्पणी',
    'Quantity': 'परिमाण',
    'Disease problems': 'रोगका समस्या',
    'Watering details': 'सिँचाइ विवरण',
    'Plant Count': 'बिरुवा संख्या',
    'crop(s)': 'बाली',

    // ---- categories ----
    'Vegetable': 'तरकारी',
    'Plant': 'बिरुवा',
    'Tree': 'रुख',
    'Animal': 'पशु',
    'Fruit': 'फलफूल',
    'Grain': 'अन्न',
    'Dairy': 'डेरी',
    'Handicraft': 'हस्तकला',
    'Seed': 'बीउ',
    'Tool': 'औजार',
    'Other': 'अन्य',

    // ---- profile ----
    'Edit profile': 'प्रोफाइल सम्पादन',
    'About you — what you do / sell': 'तपाईंको बारेमा — के गर्नुहुन्छ / बेच्नुहुन्छ',
    'Address (village, municipality)': 'ठेगाना (गाउँ, नगरपालिका)',
    'Change photo': 'फोटो परिवर्तन',
    'Change password': 'पासवर्ड परिवर्तन',
    'New password': 'नयाँ पासवर्ड',
    'Update password': 'पासवर्ड अपडेट',
    'Member since': 'सदस्य भएको',
    'View public profile': 'सार्वजनिक प्रोफाइल हेर्नुहोस्',
    'Show my phone number on my public profile': 'मेरो सार्वजनिक प्रोफाइलमा फोन नम्बर देखाउनुहोस्',
    'Your email and password are always private.': 'तपाईंको इमेल र पासवर्ड सधैं गोप्य रहन्छ।',
    'Ward (Taplejung Nagarpalika)': 'वडा (ताप्लेजुङ नगरपालिका)',
    'Select Ward': 'वडा छान्नुहोस्',
    'English': 'अङ्ग्रेजी',

    // ---- admin ----
    'Super Admin Dashboard': 'सुपर एडमिन ड्यासबोर्ड',
    'Tap any card to drill in.': 'विवरण हेर्न कुनै कार्डमा थिच्नुहोस्।',
    'Farmers': 'किसानहरू',
    'Farms': 'खेतहरू',
    'Crops': 'बालीहरू',
    'Disease Reports': 'रोग प्रतिवेदन',
    'Crops by Category': 'वर्ग अनुसार बाली',
    'Crop Health': 'बाली स्वास्थ्य',
    'Top Disease Reports': 'प्रमुख रोग प्रतिवेदन',
    'Filter by ward': 'वडा अनुसार छान्नुहोस्',
    'All wards': 'सबै वडा',
    'No ward': 'वडा छैन',
    'disabled': 'निष्क्रिय',
    'View farms': 'खेतहरू हेर्नुहोस्',
    'View crops': 'बालीहरू हेर्नुहोस्',
    'Verify Experts': 'विशेषज्ञ प्रमाणित गर्नुहोस्',
    'Open Ward Overview': 'वडा अवलोकन खोल्नुहोस्',
    'Ward Overview — Taplejung': 'वडा अवलोकन — ताप्लेजुङ',
    'Farmers, farms, crops and sales for each ward. Tap a ward to see its farmers.': 'प्रत्येक वडाको किसान, खेत, बाली र बिक्री। किसानहरू हेर्न वडामा थिच्नुहोस्।',
    'Registered farmers with a ward': 'वडा भएका दर्ता किसान',
    'sales': 'बिक्री',
    'farmers': 'किसान',
    'farms': 'खेत',
    'crops': 'बाली',
    'Dashboard ': 'ड्यासबोर्ड ',

    // ---- bazar / marketplace ----
    'My Shop': 'मेरो पसल',
    'Sell': 'बेच्नुहोस्',
    'Search products, location…': 'सामान, स्थान खोज्नुहोस्…',
    'All': 'सबै',
    'Newest first': 'नयाँ पहिले',
    'Price: Low to High': 'मूल्य: कम देखि बढी',
    'Price: High to Low': 'मूल्य: बढी देखि कम',
    'Min price (Rs)': 'न्यूनतम मूल्य (रु)',
    'Max price (Rs)': 'अधिकतम मूल्य (रु)',
    'Filters': 'फिल्टर',
    'Apply': 'लागू गर्नुहोस्',
    'Clear all': 'सबै हटाउनुहोस्',
    'No products found.': 'कुनै सामान भेटिएन।',
    'Be the first to list one — tap Sell.': 'पहिलो बनेर सूचीबद्ध गर्नुहोस् — बेच्नुहोस् थिच्नुहोस्।',
    'Product name (e.g. Fresh Tomatoes)': 'सामानको नाम (जस्तै ताजा गोलभेडा)',
    'Description (optional)': 'विवरण (वैकल्पिक)',
    'Price (Rs)': 'मूल्य (रु)',
    'Quantity available': 'उपलब्ध परिमाण',
    'Location (e.g. Phungling)': 'स्थान (जस्तै फुङलिङ)',
    'Contact phone (optional)': 'सम्पर्क फोन (वैकल्पिक)',
    'Message to seller (optional)': 'बिक्रेतालाई सन्देश (वैकल्पिक)',
    'products': 'सामानहरू',
    'product': 'सामान',
    'sold': 'बिक्री भयो',
    'Order': 'अर्डर',
    'Total': 'जम्मा',

    // ---- weather ----
    'Allow location': 'स्थान अनुमति दिनुहोस्',

    // ---- sales / expenses / market forms ----
    'Product (e.g. Tomato)': 'उत्पादन (जस्तै गोलभेडा)',
    'Amount (Rs)': 'रकम (रु)',
    'Number of workers': 'कामदार संख्या',
    'Wage per worker (Rs)': 'प्रति कामदार ज्याला (रु)',
    'Cost per unit (Rs)': 'प्रति इकाइ मूल्य (रु)',
    'Description (e.g. Urea fertilizer / Field weeding)': 'विवरण (जस्तै युरिया मल / गोडमेल)',
    'Unit (kg)': 'इकाइ (के.जी.)',
    'Unit e.g. per kg': 'इकाइ जस्तै प्रति के.जी.',
    'Buyer (optional)': 'खरिदकर्ता (वैकल्पिक)',
    'Price / unit (Rs)': 'मूल्य / इकाइ (रु)',
    'Price': 'मूल्य',

    // ---- chat / disease / expert ----
    'Type your message...': 'आफ्नो सन्देश लेख्नुहोस्...',
    'Type your question…': 'आफ्नो प्रश्न लेख्नुहोस्…',
    'Describe symptom e.g. yellow leaves': 'लक्षण लेख्नुहोस् जस्तै पहेंलो पात',
    'Specialization': 'विशेषज्ञता',
    'Bio': 'परिचय',
    'Title': 'शीर्षक',
    'Message': 'सन्देश',
    'Crop': 'बाली',
    '🔍 Search name, specialization or phone': '🔍 नाम, विशेषज्ञता वा फोन खोज्नुहोस्',
    'Verified': 'प्रमाणित',
    'Available': 'उपलब्ध',
    'Approve': 'स्वीकृत गर्नुहोस्',

    // ---- toasts ----
    'Crop added': 'बाली थपियो',
    'Field added': 'खेत थपियो',
    'Updated & history saved': 'अपडेट भयो र इतिहास सुरक्षित भयो',
    'Deleted': 'मेटाइयो',
    'Sent': 'पठाइयो',
    'Listed in Bazar': 'बजारमा सूचीबद्ध भयो',
    'Marked sold': 'बिक्री भएको चिन्ह लगाइयो',
    'Relisted': 'पुनः सूचीबद्ध भयो',
    'Profile updated': 'प्रोफाइल अपडेट भयो',
    'Password updated': 'पासवर्ड अपडेट भयो',
    'Name cannot be empty': 'नाम खाली हुन सक्दैन',
    'Password must be at least 4 characters': 'पासवर्ड कम्तिमा ४ अक्षरको हुनुपर्छ',
    'Expense recorded': 'खर्च रेकर्ड भयो',
    'Sale recorded': 'बिक्री रेकर्ड भयो',
    'Price added': 'मूल्य थपियो',
    'Price updated': 'मूल्य अपडेट भयो',
    'Saved': 'सुरक्षित भयो',
    'Updated': 'अपडेट भयो',
    'Order placed — seller notified': 'अर्डर भयो — बिक्रेतालाई सूचित गरियो',
    'Location enabled': 'स्थान सक्षम भयो',
    'Enter a description': 'विवरण लेख्नुहोस्',
    'Enter a price': 'मूल्य लेख्नुहोस्',
    'Enter a product name': 'सामानको नाम लेख्नुहोस्',
    'Enter a quantity': 'परिमाण लेख्नुहोस्',
    'Enter a valid price': 'मान्य मूल्य लेख्नुहोस्',
    'Enter the product': 'सामान लेख्नुहोस्',
    'Crop and price required': 'बाली र मूल्य आवश्यक',
    'Expert not found': 'विशेषज्ञ भेटिएन',
    'Location not supported on this device': 'यो यन्त्रमा स्थान समर्थित छैन',
    'Requesting location…': 'स्थान अनुरोध गर्दै…',
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Single regex of all phrases, longest first, bounded so we don't match inside
  // a longer English word (e.g. "Sell" must not match inside "Seller").
  let RE = null;
  function buildRegex() {
    const keys = Object.keys(NE).sort((a, b) => b.length - a.length).map(escapeRe);
    RE = new RegExp('(?<![A-Za-z0-9])(' + keys.join('|') + ')(?![A-Za-z0-9])', 'g');
  }
  function tr(s) {
    if (!RE) buildRegex();
    return s.replace(RE, (m) => NE[m] || m);
  }

  // ---- DOM application (browser only) ----
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { tr, NE };
    return;
  }

  let lang = localStorage.getItem('ks_lang') || 'en';
  const nodeCache = new WeakMap();  // textNode -> original English
  const attrCache = new WeakMap();  // element  -> { placeholder, title }

  function translateNode(node) {
    const cur = node.nodeValue;
    let orig = nodeCache.get(node);
    // If the text was changed externally (e.g. a toast message or a live badge
    // count) to something that is neither the cached English nor its translation,
    // treat the new text as a fresh English source and re-cache it.
    if (orig === undefined || (cur !== orig && cur !== tr(orig))) {
      orig = cur;
      nodeCache.set(node, cur);
    }
    node.nodeValue = lang === 'ne' ? tr(orig) : orig;
  }
  function translateAttrs(el) {
    let c = attrCache.get(el);
    if (!c) {
      c = {};
      if (el.hasAttribute('placeholder')) c.placeholder = el.getAttribute('placeholder');
      if (el.hasAttribute('title')) c.title = el.getAttribute('title');
      attrCache.set(el, c);
    }
    if (c.placeholder != null) el.setAttribute('placeholder', lang === 'ne' ? tr(c.placeholder) : c.placeholder);
    if (c.title != null) el.setAttribute('title', lang === 'ne' ? tr(c.title) : c.title);
  }
  function apply(root, force) {
    root = root || document.body;
    // English is the source language, so on normal renders there's nothing to do.
    // Only walk the DOM when showing Nepali, or when explicitly toggling (force).
    if (lang !== 'ne' && !force) { updateToggle(); return; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.nodeName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateNode);
    root.querySelectorAll('[placeholder],[title]').forEach(translateAttrs);
    updateToggle();
  }
  function updateToggle() {
    document.querySelectorAll('.lang-btn').forEach((b) => {
      b.textContent = lang === 'ne' ? 'EN' : 'ने';
    });
  }
  function setLang(l) {
    lang = l === 'ne' ? 'ne' : 'en';
    localStorage.setItem('ks_lang', lang);
    apply(document.body, true); // force: restore English or apply Nepali across the page
  }
  function toggle() { setLang(lang === 'ne' ? 'en' : 'ne'); }

  window.I18N = { apply, setLang, toggle, tr, get lang() { return lang; } };
})();
