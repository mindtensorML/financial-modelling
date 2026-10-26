import { phraseTokens } from './normalize'

/** Listed in a typical walking order; stores you shop at learn their own order over time. */
export const CATEGORIES = [
  'Produce',
  'Bakery',
  'Deli',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Frozen',
  'Pantry',
  'Breakfast',
  'Snacks',
  'Beverages',
  'Household',
  'Personal Care',
  'Health',
  'Baby',
  'Pet',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

export function defaultCategoryRank(category: Category): number {
  return CATEGORIES.indexOf(category) / (CATEGORIES.length - 1)
}

// Singular forms. When a word appears in two categories, the first listing wins,
// so ambiguous words are placed where shoppers most often mean them.
const KEYWORDS: Record<Category, string[]> = {
  Produce: [
    'apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'strawberry', 'blueberry', 'raspberry',
    'blackberry', 'berry', 'cherry', 'peach', 'pear', 'plum', 'nectarine', 'apricot', 'mango',
    'pineapple', 'watermelon', 'cantaloupe', 'honeydew', 'melon', 'kiwi', 'avocado', 'tomato',
    'cherry tomato', 'potato', 'sweet potato', 'yam', 'onion', 'red onion', 'green onion', 'scallion',
    'shallot', 'garlic', 'ginger', 'carrot', 'baby carrot', 'celery', 'cucumber', 'zucchini', 'squash',
    'butternut squash', 'pumpkin', 'bell pepper', 'pepper', 'jalapeno', 'chili', 'lettuce', 'romaine',
    'spinach', 'baby spinach', 'kale', 'arugula', 'cabbage', 'broccoli', 'cauliflower', 'brussels sprout',
    'asparagus', 'green bean', 'corn', 'mushroom', 'eggplant', 'radish', 'beet', 'turnip', 'parsnip',
    'leek', 'fennel', 'artichoke', 'okra', 'herb', 'basil', 'cilantro', 'parsley', 'mint', 'dill',
    'rosemary', 'thyme', 'salad', 'salad mix', 'spring mix', 'coleslaw', 'fruit', 'vegetable', 'veggie',
    'grapefruit', 'clementine', 'mandarin', 'tangerine', 'pomegranate', 'fig', 'coconut', 'papaya',
    'plantain', 'bok choy', 'sprout', 'tofu', 'produce',
  ],
  Bakery: [
    'bread', 'loaf', 'baguette', 'bagel', 'bun', 'hamburger bun', 'hot dog bun', 'roll', 'dinner roll',
    'croissant', 'muffin', 'english muffin', 'tortilla', 'corn tortilla', 'flour tortilla', 'pita', 'naan',
    'sourdough', 'brioche', 'ciabatta', 'cake', 'cupcake', 'donut', 'doughnut', 'pastry', 'pie',
    'danish', 'scone', 'flatbread', 'wrap', 'banana bread', 'garlic bread',
  ],
  Deli: [
    'deli', 'deli meat', 'lunch meat', 'cold cut', 'sliced turkey', 'deli turkey', 'salami', 'prosciutto',
    'pepperoni', 'hummus', 'dip', 'guacamole', 'rotisserie chicken', 'sandwich', 'sushi', 'pesto',
  ],
  'Meat & Seafood': [
    'chicken', 'chicken breast', 'chicken thigh', 'chicken wing', 'drumstick', 'beef', 'ground beef',
    'steak', 'ribeye', 'sirloin', 'brisket', 'roast', 'pork', 'pork chop', 'pork loin', 'bacon', 'sausage',
    'hot dog', 'ground turkey', 'turkey', 'lamb', 'veal', 'meatball', 'burger', 'patty', 'rib', 'ham',
    'salmon', 'tuna steak', 'shrimp', 'prawn', 'cod', 'tilapia', 'halibut', 'trout', 'fish', 'crab',
    'lobster', 'scallop', 'mussel', 'clam', 'oyster', 'seafood', 'meat', 'chorizo',
  ],
  'Dairy & Eggs': [
    'milk', 'whole milk', 'skim milk', 'almond milk', 'oat milk', 'soy milk', 'half and half', 'cream',
    'heavy cream', 'whipping cream', 'sour cream', 'cream cheese', 'cheese', 'cheddar', 'mozzarella',
    'parmesan', 'feta', 'goat cheese', 'brie', 'swiss', 'provolone', 'ricotta', 'cottage cheese',
    'string cheese', 'shredded cheese', 'butter', 'margarine', 'yogurt', 'yoghurt', 'greek yogurt', 'kefir',
    'egg', 'creamer', 'coffee creamer', 'whipped cream', 'dairy', 'chocolate milk',
  ],
  Frozen: [
    'ice cream', 'frozen pizza', 'pizza', 'popsicle', 'ice', 'tater tot', 'french fry', 'fry', 'gelato',
    'sorbet', 'frozen yogurt', 'ice pop', 'edamame', 'frozen vegetable', 'frozen fruit', 'fish stick',
  ],
  Pantry: [
    'rice', 'pasta', 'spaghetti', 'penne', 'macaroni', 'noodle', 'egg noodle', 'ramen', 'flour', 'sugar',
    'brown sugar', 'salt', 'black pepper', 'oil', 'olive oil', 'vegetable oil', 'canola oil', 'coconut oil',
    'vinegar', 'soy sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'hot sauce', 'sriracha',
    'bbq sauce', 'barbecue sauce', 'salad dressing', 'dressing', 'ranch', 'sauce', 'pasta sauce',
    'marinara', 'tomato sauce', 'tomato paste', 'salsa', 'honey', 'maple syrup', 'syrup', 'peanut butter',
    'almond butter', 'jam', 'jelly', 'nutella', 'bean', 'black bean', 'chickpea', 'lentil', 'soup', 'broth',
    'stock', 'chicken broth', 'beef broth', 'canned tomato', 'tuna', 'sardine', 'spice', 'cinnamon', 'cumin',
    'paprika', 'oregano', 'chili powder', 'garlic powder', 'onion powder', 'vanilla', 'vanilla extract',
    'baking soda', 'baking powder', 'yeast', 'cornstarch', 'breadcrumb', 'bread crumb', 'quinoa',
    'couscous', 'coconut milk', 'olive', 'pickle', 'caper', 'seasoning', 'bouillon', 'gravy', 'stuffing',
    'mac and cheese', 'chocolate chip', 'cocoa', 'applesauce', 'apple sauce', 'pantry', 'taco shell',
  ],
  Breakfast: [
    'cereal', 'oatmeal', 'oat', 'granola', 'pancake mix', 'pancake', 'waffle', 'pop tart', 'grits',
  ],
  Snacks: [
    'chip', 'potato chip', 'tortilla chip', 'pretzel', 'popcorn', 'cracker', 'cookie', 'candy', 'chocolate',
    'milk chocolate', 'dark chocolate', 'chocolate bar',
    'granola bar', 'protein bar', 'nut', 'almond', 'cashew', 'peanut', 'pistachio', 'walnut', 'pecan',
    'trail mix', 'dried fruit', 'raisin', 'gummy', 'gummies', 'fruit snack', 'jerky', 'rice cake', 'snack',
    'goldfish',
  ],
  Beverages: [
    'water', 'sparkling water', 'seltzer', 'soda', 'cola', 'coke', 'pepsi', 'sprite', 'juice',
    'orange juice', 'apple juice', 'lemonade', 'coffee', 'coffee bean', 'ground coffee', 'tea', 'green tea',
    'kombucha', 'beer', 'wine', 'red wine', 'white wine', 'liquor', 'vodka', 'whiskey', 'gin', 'rum',
    'tequila', 'sports drink', 'gatorade', 'energy drink', 'la croix', 'coconut water', 'drink', 'hot chocolate',
  ],
  Household: [
    'paper towel', 'toilet paper', 'tissue', 'napkin', 'trash bag', 'garbage bag', 'dish soap',
    'dishwasher detergent', 'dishwasher pod', 'laundry detergent', 'detergent', 'fabric softener',
    'dryer sheet', 'bleach', 'cleaner', 'all purpose cleaner', 'sponge', 'aluminum foil', 'foil',
    'plastic wrap', 'cling wrap', 'parchment paper', 'ziploc', 'sandwich bag', 'freezer bag', 'light bulb',
    'battery', 'candle', 'disinfecting wipe', 'wipe', 'air freshener', 'glass cleaner', 'paper plate',
    'plastic cup', 'straw', 'charcoal', 'lysol', 'clorox', 'windex', 'towel', 'trash',
  ],
  'Personal Care': [
    'shampoo', 'conditioner', 'body wash', 'soap', 'hand soap', 'bar soap', 'toothpaste', 'toothbrush',
    'floss', 'mouthwash', 'deodorant', 'razor', 'shaving cream', 'lotion', 'sunscreen', 'lip balm',
    'chapstick', 'cotton ball', 'q tip', 'cotton swab', 'tampon', 'pad', 'makeup', 'face wash',
    'moisturizer', 'hair gel', 'hairspray',
  ],
  Health: [
    'vitamin', 'multivitamin', 'ibuprofen', 'advil', 'tylenol', 'acetaminophen', 'aspirin',
    'allergy medicine', 'claritin', 'zyrtec', 'cough drop', 'cough syrup', 'bandage', 'band aid',
    'first aid', 'antacid', 'tums', 'melatonin', 'prescription', 'medicine', 'thermometer',
    'contact solution', 'eye drop', 'fish oil', 'probiotic', 'protein powder',
  ],
  Baby: ['diaper', 'baby wipe', 'formula', 'baby formula', 'baby food', 'pacifier', 'baby', 'sippy cup'],
  Pet: [
    'dog food', 'cat food', 'kitty litter', 'cat litter', 'litter', 'dog treat', 'cat treat', 'pet food',
    'dog', 'cat', 'bird seed', 'fish food', 'pet',
  ],
  Other: [],
}

// A product described as frozen or canned lives in that aisle whatever it is.
const OVERRIDES: Array<[string, Category]> = [
  ['frozen', 'Frozen'],
  ['canned', 'Pantry'],
]

const phraseIndex = new Map<string, Category>()
let maxPhraseWords = 1
for (const category of CATEGORIES) {
  for (const phrase of KEYWORDS[category]) {
    const tokens = phraseTokens(phrase)
    const key = tokens.join(' ')
    if (!phraseIndex.has(key)) phraseIndex.set(key, category)
    maxPhraseWords = Math.max(maxPhraseWords, tokens.length)
  }
}

export const MAX_PHRASE_WORDS = maxPhraseWords

// Receipts print the flavor after the product ("GREEK YGRT VAN"), so a flavor only decides
// the category when nothing before it does.
const FLAVORS = new Set([
  'vanilla', 'chocolate', 'strawberry', 'blueberry', 'raspberry', 'cherry', 'peach', 'mango', 'honey',
  'caramel', 'cinnamon', 'coconut', 'mint', 'lemon', 'lime',
])

/**
 * Picks the category of the phrase that ends closest to the end of the name, because the
 * last word is usually the head noun ("chicken soup" is soup, "hot dog buns" are buns).
 * At the same end position, the longer phrase wins ("peanut butter" over "butter").
 */
export function classify(name: string): Category {
  const tokens = phraseTokens(name)
  for (const [word, category] of OVERRIDES) if (tokens.includes(word)) return category
  let flavor: Category | null = null
  for (let end = tokens.length - 1; end >= 0; end--) {
    for (let len = Math.min(maxPhraseWords, end + 1); len >= 1; len--) {
      const phrase = tokens.slice(end - len + 1, end + 1).join(' ')
      const category = phraseIndex.get(phrase)
      if (!category) continue
      if (len === 1 && end > 0 && FLAVORS.has(phrase)) {
        flavor ??= category
        break
      }
      return category
    }
  }
  return flavor ?? 'Other'
}

/** Singular phrases ("paper towel", "milk") known to be grocery items. */
export function groceryLexicon(): Set<string> {
  return new Set(phraseIndex.keys())
}
