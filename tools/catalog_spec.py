"""The catalog to generate: one line per garment. Used by cloud_modal/generate_garments.py and tools/prepare_garments.py.

(id, gender, category, display name, colour, picture description, backdrop)
Categories: tshirts, shirts, formal, sweats, jackets. Backdrop "grey" is for white or very light garments, whose
cut-out would be eaten on a white background. Logos and words are invented brands, not real trademarks.
"""

GREY = "grey"
NEW_ITEMS = [
    # ---------- men: t-shirts ----------
    ("m-tee-white", "men", "tshirts", "Classic White Tee", "White", "a white men's cotton crew-neck t-shirt", GREY),
    ("m-tee-navy-logo", "men", "tshirts", "North Club Tee", "Navy", "a navy blue men's t-shirt with a small chest logo that reads 'NORTH CLUB'", ""),
    ("m-tee-mountain", "men", "tshirts", "Mountain Print Tee", "Charcoal", "a charcoal grey men's t-shirt with a large mountain and rising sun graphic print on the chest", ""),
    ("m-tee-studio", "men", "tshirts", "Studio 24 Tee", "Red", "a red men's t-shirt with the words 'STUDIO 24' in bold white letters across the chest", ""),
    ("m-polo-green", "men", "polos", "Green Polo", "Green", "a dark green men's polo shirt with a white collar and a small embroidered logo on the chest", ""),
    ("m-polo-stripe", "men", "polos", "Striped Polo", "Navy & White", "a navy and white horizontally striped men's polo shirt", GREY),
    # ---------- men: polos ----------
    ("m-polo-white", "men", "polos", "White Polo", "White", "a white men's cotton pique polo shirt with a collar and a two-button placket", GREY),
    ("m-polo-navy", "men", "polos", "Navy Polo", "Navy", "a navy blue men's pique polo shirt with a collar and a two-button placket", ""),
    ("m-polo-black", "men", "polos", "Black Polo", "Black", "a black men's pique polo shirt with a collar and a two-button placket", ""),
    ("m-polo-maroon", "men", "polos", "Maroon Polo", "Maroon", "a maroon men's pique polo shirt with a collar and a two-button placket", ""),
    ("m-polo-block", "men", "polos", "Colour-Block Polo", "Navy & Red", "a men's polo shirt with a navy body, a red chest panel and white collar trim", ""),
    ("m-polo-olive", "men", "polos", "Olive Polo", "Olive", "an olive green men's pique polo shirt with a collar and a two-button placket", ""),
    # ---------- men: shirts ----------
    ("m-shirt-check", "men", "shirts", "Blue Check Shirt", "Blue", "a blue and white check men's casual button-up shirt with long sleeves", ""),
    ("m-shirt-check-bold", "men", "shirts", "Bold Check Shirt", "Blue", "a men's casual button-up shirt with a large, bold blue and white gingham check (big simple squares, about 2 cm each), a collar and long sleeves", GREY),
    ("m-shirt-denim", "men", "shirts", "Denim Shirt", "Denim", "a mid-wash denim men's shirt with two chest pockets and long sleeves", ""),
    ("m-shirt-linen", "men", "shirts", "Linen Shirt", "Beige", "a beige linen men's button-up shirt with long sleeves", ""),
    ("m-shirt-black", "men", "shirts", "Black Casual Shirt", "Black", "a black men's casual button-up shirt with long sleeves", ""),
    # ---------- men: formal ----------
    ("m-formal-white", "men", "formal", "White Formal Shirt", "White", "a white men's formal dress shirt with a collar and long sleeves", GREY),
    ("m-formal-blue", "men", "formal", "Blue Formal Shirt", "Light Blue", "a light blue men's formal dress shirt with a collar and long sleeves", ""),
    ("m-formal-check", "men", "formal", "Check Formal Shirt", "Navy", "a men's formal dress shirt with a large, simple navy and white check pattern (big clear squares, about 2 cm each), a collar and long sleeves", GREY),
    ("m-formal-pinstripe", "men", "formal", "Pinstripe Shirt", "Blue", "a men's formal shirt with thin navy pinstripes on white, with a collar and long sleeves", GREY),
    ("m-blazer-navy", "men", "formal", "Navy Blazer", "Navy", "a navy blue men's single-breasted blazer", ""),
    ("m-blazer-grey", "men", "formal", "Grey Blazer", "Grey", "a charcoal grey men's two-button blazer", ""),
    ("m-waistcoat", "men", "formal", "Charcoal Waistcoat", "Charcoal", "a sleeveless charcoal men's three-piece-suit waistcoat (vest) with buttons, no sleeves at all, armholes visible", ""),
    # ---------- men: sweatshirts and hoodies ----------
    ("m-hoodie-city", "men", "sweats", "City Life Hoodie", "Grey", "a grey men's pullover hoodie with the words 'CITY LIFE' printed in large black letters across the chest", ""),
    ("m-hoodie-black", "men", "sweats", "Black Logo Hoodie", "Black", "a black men's pullover hoodie with a small white logo on the chest", ""),
    ("m-sweatshirt-varsity", "men", "sweats", "Varsity Sweatshirt", "Green", "a dark green men's crew-neck sweatshirt with a large white letter 'F' varsity patch on the chest", ""),
    ("m-sweatshirt-zip", "men", "sweats", "Navy Zip Sweatshirt", "Navy", "a navy men's zip-up sweatshirt with a stand collar", ""),
    # ---------- men: jackets ----------
    ("m-jacket-bomber", "men", "jackets", "Olive Bomber", "Olive", "an olive green men's bomber jacket with ribbed cuffs and a zip", ""),
    ("m-jacket-denim", "men", "jackets", "Denim Jacket", "Denim", "a blue men's denim trucker jacket with chest pockets", ""),
    ("m-jacket-puffer", "men", "jackets", "Black Puffer", "Black", "a black men's puffer jacket with a zip", ""),
    ("m-jacket-leather", "men", "jackets", "Leather Jacket", "Brown", "a brown men's leather biker jacket with a zip", ""),
    ("m-jacket-track", "men", "jackets", "Red Track Jacket", "Red", "a red men's track jacket with two white stripes on the sleeves", ""),
    # ---------- women: t-shirts ----------
    ("w-tee-white", "women", "tshirts", "Classic White Tee", "White", "a white women's cotton crew-neck t-shirt", GREY),
    ("w-tee-yellow", "women", "tshirts", "Sunshine Tee", "Yellow", "a yellow women's fitted t-shirt", ""),
    ("w-tee-bloom", "women", "tshirts", "Bloom Print Tee", "Pink", "a pink women's t-shirt with a large watercolour flower graphic on the chest", ""),
    ("w-tee-atelier", "women", "tshirts", "Atelier Tee", "Black", "a black women's t-shirt with the word 'ATELIER' in small white letters on the chest", ""),
    ("w-tee-love", "women", "tshirts", "Slogan Tee", "Lilac", "a lilac women's t-shirt with the words 'GOOD VIBES' in bold dark letters across the chest", ""),
    # ---------- women: polos ----------
    ("w-polo-white", "women", "polos", "White Polo", "White", "a white women's fitted pique polo shirt with a collar and a short placket", GREY),
    ("w-polo-pink", "women", "polos", "Pink Polo", "Pink", "a pink women's fitted pique polo shirt with a collar and a short placket", ""),
    ("w-polo-navy", "women", "polos", "Navy Polo", "Navy", "a navy blue women's fitted pique polo shirt with a collar and a short placket", ""),
    ("w-polo-sage", "women", "polos", "Sage Polo", "Sage", "a sage green women's fitted pique polo shirt with a collar and a short placket", ""),
    ("w-polo-stripe", "women", "polos", "Striped Polo", "Navy & White", "a navy and white horizontally striped women's fitted polo shirt with a collar", GREY),
    ("w-polo-black", "women", "polos", "Black Polo", "Black", "a black women's fitted pique polo shirt with a collar and a short placket", ""),
    # ---------- women: shirts and blouses ----------
    ("w-shirt-blouse", "women", "shirts", "White Blouse", "White", "a white women's blouse with long sleeves and a collar", GREY),
    ("w-shirt-stripe", "women", "shirts", "Striped Shirt", "Blue & White", "a blue and white vertically striped women's button-up shirt with long sleeves", GREY),
    ("w-shirt-denim", "women", "shirts", "Denim Shirt", "Denim", "a light-wash denim women's shirt with long sleeves", ""),
    ("w-shirt-floral", "women", "shirts", "Floral Blouse", "Floral", "a women's long-sleeve blouse with a small floral print on a cream background", ""),
    ("w-shirt-satin", "women", "shirts", "Satin Blouse", "Blush", "a blush pink satin women's blouse with long sleeves", ""),
    # ---------- women: formal ----------
    ("w-formal-white", "women", "formal", "White Formal Shirt", "White", "a white women's formal shirt with a collar and long sleeves", GREY),
    ("w-blazer-black", "women", "formal", "Black Blazer", "Black", "a black women's tailored blazer", ""),
    ("w-blazer-camel", "women", "formal", "Camel Blazer", "Camel", "a camel brown women's single-breasted blazer", ""),
    ("w-waistcoat", "women", "formal", "Grey Waistcoat", "Grey", "a sleeveless grey women's tailored waistcoat (vest) with buttons, no sleeves at all, armholes visible", ""),
    ("w-formal-bow", "women", "formal", "Bow Blouse", "Navy", "a navy women's formal blouse with a bow at the neck and long sleeves", ""),
    # ---------- women: sweatshirts and hoodies ----------
    ("w-hoodie-dreamer", "women", "sweats", "Dreamer Hoodie", "Pink", "a pink women's pullover hoodie with the word 'DREAMER' in large white letters across the chest", ""),
    ("w-sweatshirt-green", "women", "sweats", "Green Logo Sweatshirt", "Green", "a sage green women's crew-neck sweatshirt with a small embroidered logo on the chest", ""),
    ("w-hoodie-black-zip", "women", "sweats", "Black Zip Hoodie", "Black", "a black women's zip-up hoodie", ""),
    # ---------- women: jackets ----------
    ("w-jacket-denim", "women", "jackets", "Denim Jacket", "Denim", "a light blue women's denim jacket", ""),
    ("w-jacket-bomber", "women", "jackets", "Pink Bomber", "Pink", "a pink women's bomber jacket with ribbed cuffs and a zip", ""),
    ("w-jacket-puffer", "women", "jackets", "White Puffer", "White", "a white women's puffer jacket with a zip", GREY),
    ("w-jacket-leather", "women", "jackets", "Black Leather Jacket", "Black", "a black women's leather biker jacket with a zip", ""),
    ("w-jacket-trench", "women", "jackets", "Beige Trench", "Beige", "a beige women's trench coat with a belt and buttons, waist length to hip length", ""),
    # ---------- bottoms (test category: needs the legs in view; phone version recommended) ----------
    ("m-jeans-blue", "men", "bottoms", "Blue Jeans", "Blue", "a pair of mid-wash blue men's straight-leg jeans", ""),
    ("m-chinos-beige", "men", "bottoms", "Beige Chinos", "Beige", "a pair of beige men's chino trousers", ""),
    ("m-trousers-grey", "men", "bottoms", "Grey Formal Trousers", "Grey", "a pair of charcoal grey men's formal trousers with a crease", ""),
    ("m-joggers-black", "men", "bottoms", "Black Joggers", "Black", "a pair of black men's joggers with an elastic cuff", ""),
    ("m-cargo-olive", "men", "bottoms", "Olive Cargo Pants", "Olive", "a pair of olive green men's cargo trousers with side pockets", ""),
    ("w-jeans-blue", "women", "bottoms", "Blue Jeans", "Blue", "a pair of mid-wash blue women's high-waist straight-leg jeans", ""),
    ("w-trousers-black", "women", "bottoms", "Black Trousers", "Black", "a pair of black women's tailored straight-leg trousers", ""),
    ("w-trousers-cream", "women", "bottoms", "Cream Wide-Leg Trousers", "Cream", "a pair of cream women's wide-leg trousers", ""),
    ("w-skirt-midi", "women", "bottoms", "Navy Culottes", "Navy", "a pair of navy blue women's wide-leg culottes", ""),
    ("w-joggers-grey", "women", "bottoms", "Grey Joggers", "Grey", "a pair of grey women's joggers with an elastic cuff", ""),
]
