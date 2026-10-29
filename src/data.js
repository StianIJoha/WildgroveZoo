/* Wildgrove Zoo v2 — game data */
const GAME = (function () {
'use strict';

const BIOMES = {
  meadow:  { name: 'Meadow',       lvl: 1, cost: 100,  g1: '#9fd27a', g2: '#94c96f', fence: '#a8734a', rail: '#c48d5c' },
  ice:     { name: 'Ice floe',     lvl: 1, cost: 150,  g1: '#e4f1f7', g2: '#d3e7f0', fence: '#7aa6bf', rail: '#a8cde0', pool: true },
  lagoon:  { name: 'Lagoon',       lvl: 3, cost: 400,  g1: '#c8e6a0', g2: '#b9dc8f', fence: '#8a6a4a', rail: '#b38a5e', pool: true },
  desert:  { name: 'Dunes',        lvl: 4, cost: 500,  g1: '#f0d7a1', g2: '#e8cb8e', fence: '#a0704a', rail: '#c9935f' },
  bamboo:  { name: 'Bamboo grove', lvl: 3, cost: 500,  g1: '#7fbf68', g2: '#74b35e', fence: '#6f8f3e', rail: '#9cbf5a' },
  savanna: { name: 'Savanna',      lvl: 6, cost: 900,  g1: '#e3cf86', g2: '#d8c277', fence: '#8f6540', rail: '#b88452' },
  coast:   { name: 'Coast',        lvl: 5, cost: 700,  g1: '#eadfb8', g2: '#e1d4aa', fence: '#6f8792', rail: '#a3bac4', pool: true },
};

// appeal = attraction stars per adult; care = need-interval multiplier; breed/grow in seconds
const SPECIES = {
  bunny:     { name: 'Bunny',      lvl: 1,  cost: 60,   food: 'hay',     appeal: 3,  biome: 'meadow',  breed: 150, grow: 300,  speed: 0.9,  care: 0.9 },
  penguin:   { name: 'Penguin',    lvl: 1,  cost: 120,  food: 'fish',    appeal: 5,  biome: 'ice',     breed: 200, grow: 400,  speed: 0.45, care: 1.0 },
  parrot:    { name: 'Macaw',      lvl: 2,  cost: 150,  food: 'seeds',   appeal: 5,  biome: 'meadow',  breed: 220, grow: 420,  speed: 0.5,  care: 1.0 },
  flamingo:  { name: 'Flamingo',   lvl: 3,  cost: 220,  food: 'insects', appeal: 7,  biome: 'lagoon',  breed: 260, grow: 500,  speed: 0.4,  care: 1.0 },
  monkey:    { name: 'Capuchin',   lvl: 3,  cost: 250,  food: 'fruit',   appeal: 7,  biome: 'bamboo',  breed: 260, grow: 500,  speed: 0.9,  care: 0.85 },
  meerkat:   { name: 'Meerkat',    lvl: 4,  cost: 300,  food: 'insects', appeal: 8,  biome: 'desert',  breed: 280, grow: 540,  speed: 0.8,  care: 0.9 },
  redpanda:  { name: 'Red panda',  lvl: 5,  cost: 450,  food: 'bamboo',  appeal: 10, biome: 'bamboo',  breed: 320, grow: 620,  speed: 0.5,  care: 1.05 },
  zebra:     { name: 'Zebra',      lvl: 6,  cost: 600,  food: 'hay',     appeal: 12, biome: 'savanna', breed: 360, grow: 700,  speed: 0.6,  care: 1.1 },
  crocodile: { name: 'Crocodile',  lvl: 7,  cost: 800,  food: 'meat',    appeal: 14, biome: 'lagoon',  breed: 400, grow: 780,  speed: 0.25, care: 1.35 },
  panda:     { name: 'Panda',      lvl: 8,  cost: 1000, food: 'bamboo',  appeal: 17, biome: 'bamboo',  breed: 440, grow: 860,  speed: 0.3,  care: 1.15 },
  polarbear: { name: 'Polar bear', lvl: 9,  cost: 1300, food: 'fish',    appeal: 19, biome: 'ice',     breed: 480, grow: 940,  speed: 0.4,  care: 1.2 },
  lion:      { name: 'Lion',       lvl: 10, cost: 1600, food: 'meat',    appeal: 22, biome: 'savanna', breed: 520, grow: 1000, speed: 0.45, care: 1.25 },
  giraffe:   { name: 'Giraffe',    lvl: 12, cost: 2000, food: 'hay',     appeal: 26, biome: 'savanna', breed: 560, grow: 1080, speed: 0.4,  care: 1.25 },
  elephant:  { name: 'Elephant',   lvl: 14, cost: 3000, food: 'hay',     appeal: 32, biome: 'lagoon',  breed: 600, grow: 1200, speed: 0.3,  care: 1.3 },
  seal:      { name: 'Seal',       lvl: 5,  cost: 480,  food: 'fish',    appeal: 10, biome: 'coast',   breed: 330, grow: 640,  speed: 0.35, care: 1.0 },
  otter:     { name: 'Otter',      lvl: 8,  cost: 950,  food: 'fish',    appeal: 16, biome: 'coast',   breed: 430, grow: 840,  speed: 0.7,  care: 1.1 },
  turtle:    { name: 'Sea turtle', lvl: 11, cost: 1800, food: 'kelp',    appeal: 24, biome: 'coast',   breed: 540, grow: 1040, speed: 0.2,  care: 1.2 },
};
// how far above the feet the need icon floats, per species (default 42)
const SPECIES_TOP = { giraffe: 66, crocodile: 22, elephant: 50, seal: 24, otter: 28, turtle: 20, bunny: 34, meerkat: 36 };

const FOODS = {
  hay:     { name: 'Hay',     price: 3 },
  seeds:   { name: 'Seeds',   price: 3 },
  fruit:   { name: 'Fruit',   price: 5 },
  insects: { name: 'Insects', price: 5 },
  fish:    { name: 'Fish',    price: 6 },
  bamboo:  { name: 'Bamboo',  price: 6 },
  meat:    { name: 'Meat',    price: 9 },
  kelp:    { name: 'Kelp',    price: 7 },
};
const MEDICINE_PRICE = 25;
const START_MEDICINE = 5;

// base need intervals (seconds); multiplied by species.care and a little randomness
const NEED_BASE = { food: 300, water: 240, pet: 420, play: 540 };
const NEED_LABEL = { food: 'Feed', water: 'Water', pet: 'Pet', play: 'Play' };

// shops earn on a pay period; visitors + zoo meter speed them up
const SHOPS = {
  feeder:   { name: 'Feeding station', lvl: 1,  cost: 150,  pay: 40,   period: 120,  build: 15 },
  lemonade: { name: 'Lemonade stand',  lvl: 2,  cost: 350,  pay: 110,  period: 300,  build: 30 },
  fries:    { name: 'Fries hut',       lvl: 4,  cost: 700,  pay: 260,  period: 600,  build: 45 },
  toys:     { name: 'Plush-toy booth', lvl: 6,  cost: 1400, pay: 600,  period: 1200, build: 60 },
  balloon:  { name: 'Balloon cart',    lvl: 8,  cost: 2000, pay: 900,  period: 1500, build: 75 },
  icecream: { name: 'Ice-cream parlour', lvl: 10, cost: 3000, pay: 1500, period: 2400, build: 90 },
  candy:    { name: 'Cotton-candy cart', lvl: 13, cost: 5000, pay: 2800, period: 3600, build: 120 },
  souvenir: { name: 'Souvenir shop',   lvl: 16, cost: 9000, pay: 6000, period: 7200, build: 150 },
};

// special buildings, 2×2
const BUILDINGS = {
  nursery: { name: 'Animal nursery', lvl: 5,  cost: 2500, build: 120, w: 2, h: 2, desc: 'Raises up to 3 babies at triple speed, no care needed.' },
  safari:  { name: 'Safari station', lvl: 7,  cost: 4000, build: 150, w: 2, h: 2, desc: 'Send expeditions to find rare animals, supplies and cards.' },
  lab:     { name: 'Breeding lab',   lvl: 9,  cost: 6000, build: 180, w: 2, h: 2, desc: 'Breed a pair into a baby of the same or a rarer subspecies.' },
};

const DECOR = {
  trashbin: { name: 'Trash bin',   lvl: 1, cost: 30,  appeal: 0.3, bin: true },
  bush:     { name: 'Bush',        lvl: 1, cost: 10,  appeal: 0.5 },
  flowers:  { name: 'Flower bed',  lvl: 1, cost: 20,  appeal: 1 },
  rock:     { name: 'Mossy rock',  lvl: 1, cost: 15,  appeal: 0.5 },
  oak:      { name: 'Oak tree',    lvl: 1, cost: 35,  appeal: 1.2 },
  pine:     { name: 'Pine tree',   lvl: 2, cost: 35,  appeal: 1.2 },
  bench:    { name: 'Bench',       lvl: 1, cost: 40,  appeal: 1.5 },
  lamp:     { name: 'Lamp post',   lvl: 2, cost: 50,  appeal: 1.5 },
  toilet:   { name: 'Restrooms',   lvl: 3, cost: 300, appeal: 4 },
  fountain: { name: 'Fountain',    lvl: 4, cost: 400, appeal: 6 },
  hedge:    { name: 'Box hedge',   lvl: 2, cost: 25,  appeal: 0.8 },
  torch:    { name: 'Tiki torch',  lvl: 3, cost: 60,  appeal: 1.5, light: true },
  picnic:   { name: 'Picnic table', lvl: 3, cost: 120, appeal: 2.5, rest: true },
  pond:     { name: 'Lily pond',   lvl: 4, cost: 250, appeal: 4 },
  playground: { name: 'Playground', lvl: 5, cost: 450, appeal: 5 },
  statue:   { name: 'Animal statue', lvl: 6, cost: 600, appeal: 7 },
  arch:     { name: 'Flower arch', lvl: 7, cost: 500, appeal: 5.5 },
};
DECOR.lamp.light = true; DECOR.bench.rest = true;
// event-only decor: never sold in the Build menu, only won on the event track
Object.assign(DECOR, {
  blossomtree: { name: 'Blossom tree',  lvl: 1, cost: 0, appeal: 6, event: 'spring' },
  parasol:     { name: 'Beach parasol', lvl: 1, cost: 0, appeal: 6, event: 'summer', rest: true },
  pumpkins:    { name: 'Harvest pile',  lvl: 1, cost: 0, appeal: 6, event: 'autumn' },
  snowman:     { name: 'Snowman',       lvl: 1, cost: 0, appeal: 6, event: 'winter' },
});

// weekly festival: the theme follows the season; points come from everyday play and fill a track of
// milestones. Finishing the track starts a new lap with the same rewards. The track resets every Monday.
const EVENTS = {
  spring: { name: 'Blossom Festival', months: [2, 3, 4],  decor: 'blossomtree', star: 'bunny',   color: '#ef7aa0', blurb: 'Spring is here and the zoo is in bloom.' },
  summer: { name: 'Beach Week',       months: [5, 6, 7],  decor: 'parasol',     star: 'seal',    color: '#3fa7b5', blurb: 'Sun, sand and splashing seals.' },
  autumn: { name: 'Harvest Fair',     months: [8, 9, 10], decor: 'pumpkins',    star: 'redpanda', color: '#ef8a3c', blurb: 'Crunchy leaves, warm cider and pumpkins everywhere.' },
  winter: { name: 'Winter Lights',    months: [11, 0, 1], decor: 'snowman',     star: 'penguin', color: '#5b8fd6', blurb: 'Twinkling lights and snowy penguins.' },
};
const EVENT_POINTS = { care: 1, litter: 1, dung: 1, shopCollects: 3, wishes: 4, babies: 8 };
// reward 'decor' is the event's decor; 'star' is a rare (3rd-degree) animal of the event's star species
const EVENT_TRACK = [
  { at: 15,  reward: { coins: 200 } },
  { at: 40,  reward: { paws: 3 } },
  { at: 80,  reward: { food: 25, medicine: 2 } },
  { at: 130, reward: { decor: 1 } },
  { at: 200, reward: { coins: 600, gems: 1 } },
  { at: 280, reward: { paws: 6, card: 1 } },
  { at: 380, reward: { decor: 1, gems: 1 } },
  { at: 500, reward: { coins: 1500, paws: 8 } },
  { at: 650, reward: { gems: 3 } },
  { at: 850, reward: { star: 1 } },
];

// enrichment toys placed inside an enclosure: each adds mood and makes the play need last longer
const TOYS = {
  toyBall: { name: 'Play ball',      cost: { coins: 150, paws: 2 } },
  toyLog:  { name: 'Climbing log',   cost: { coins: 300, paws: 3 } },
  toyTire: { name: 'Tyre swing',     cost: { coins: 500, paws: 4 } },
  toyPost: { name: 'Scratching post', cost: { coins: 700, paws: 5 } },
};
const TOY_SLOTS = 2, TOY_MOOD = 0.06, TOY_PLAY = 0.3;

// land: owned area grows toward the top-left of the map
const EXPANSIONS = [
  { ox: 14, oy: 14 },
  { ox: 17, oy: 14, lvl: 10, cost: 6000,  gems: 15 },
  { ox: 17, oy: 17, lvl: 13, cost: 12000, gems: 20 },
  { ox: 20, oy: 17, lvl: 16, cost: 20000, gems: 25 },
  { ox: 20, oy: 20, lvl: 19, cost: 32000, gems: 30 },
  { ox: 23, oy: 20, lvl: 22, cost: 48000, gems: 35 },
  { ox: 23, oy: 23, lvl: 25, cost: 70000, gems: 40 },
];

// enclosure upgrades: capacity 4 → 8
const UPGRADES = [
  null,
  { coins: 400,  paws: 5 },
  { coins: 1200, paws: 12 },
  { coins: 3000, paws: 25 },
  { coins: 7000, paws: 45 },
];

const HELPERS = {
  food:  { name: 'Feeding keeper',  desc: 'Feeds every hungry animal from your stock.', gems: 3, hours: 2 },
  water: { name: 'Water carrier',   desc: 'Keeps every water trough full.',             gems: 2, hours: 2 },
  pet:   { name: 'Cuddle keeper',   desc: 'Pets and plays with every animal.',          gems: 3, hours: 2 },
  clean: { name: 'Groundskeeper',   desc: 'Cleans enclosures and picks up litter.',     gems: 3, hours: 2 },
  vet:   { name: 'Zoo vet',         desc: 'Treats sick animals with your medicine stock.', gems: 2, hours: 2 },
};

const SAFARI = [
  { id: 'short', name: 'Short trip',   time: 180,  cost: { coins: 200 },             desc: 'Supplies, coins, maybe a card.' },
  { id: 'mid',   name: 'Grassland trek', time: 600, cost: { coins: 600, paws: 5 },   desc: 'Good chance of an animal.' },
  { id: 'long',  name: 'Deep expedition', time: 1800, cost: { coins: 1500, paws: 10 }, desc: 'A rare subspecies is likely.' },
];

const WHEEL = [
  { label: '250',      icon: 'coin',     color: '#f2b632', prize: { coins: 250 } },
  { label: 'Food ×20', icon: 'fruit',    color: '#9ccc4a', prize: { food: 20 } },
  { label: '3 paws',   icon: 'paw',      color: '#b48ad8', prize: { paws: 3 } },
  { label: '1 gem',    icon: 'gem',      color: '#3fa7b5', prize: { gems: 1 } },
  { label: '600',      icon: 'coin',     color: '#ef8a3c', prize: { coins: 600 } },
  { label: 'Meds ×3',  icon: 'medicine', color: '#e5767c', prize: { medicine: 3 } },
  { label: 'Card',     icon: 'card',     color: '#5b8fd6', prize: { card: 1 } },
  { label: 'Rare!',    icon: 'star',     color: '#d65b9a', prize: { rare: 1 } },
];
const WHEEL_WEIGHTS = [22, 18, 14, 8, 12, 10, 12, 4];
const WHEEL_FREE_EVERY = 4 * 3600 * 1000; // ms, real time

// collections: 5 fact cards per biome
const COLLECTIONS = {
  meadow: { name: 'Meadow collection', reward: { coins: 600, xp: 120, gems: 2, item: 'flowers' }, cards: [
    'A rabbit\'s front teeth never stop growing. Chewing hay keeps them short.',
    'Macaws can live for more than 50 years and often pair up for life.',
    'A wildflower meadow can host hundreds of insect species in a single field.',
    'Rabbits thump the ground with their hind feet to warn each other of danger.',
    'Parrots hold food with one foot and are usually left- or right-footed.' ] },
  ice: { name: 'Ice floe collection', reward: { coins: 900, xp: 160, gems: 3, item: 'fountain' }, cards: [
    'Penguins cannot fly, but some swim faster than 30 km/h.',
    'A polar bear\'s fur looks white, yet its skin underneath is black.',
    'Emperor penguin fathers keep the egg warm on their feet for about two months.',
    'Polar bears can smell a seal from more than a kilometre away.',
    'Penguins huddle in groups and take turns standing on the cold outside edge.' ] },
  lagoon: { name: 'Lagoon collection', reward: { coins: 1400, xp: 220, gems: 3, item: 'fountain' }, cards: [
    'Flamingos are pink because of pigments in the shrimp and algae they eat.',
    'Crocodiles cannot stick their tongues out.',
    'Elephants use their trunks as a snorkel when they swim.',
    'A flamingo often rests on one leg, which saves body heat.',
    'An elephant\'s trunk has tens of thousands of muscles.' ] },
  desert: { name: 'Dunes collection', reward: { coins: 1200, xp: 200, gems: 3, item: 'rock' }, cards: [
    'Meerkats take turns acting as lookout while the rest of the group forages.',
    'The dark patches around a meerkat\'s eyes cut down the desert glare.',
    'Desert sand can be hotter than 70 °C at midday and freezing at night.',
    'Meerkats are immune to some kinds of scorpion venom.',
    'A meerkat group is called a mob or a gang.' ] },
  bamboo: { name: 'Bamboo grove collection', reward: { coins: 1800, xp: 260, gems: 4, item: 'lamp' }, cards: [
    'Giant pandas spend up to 14 hours a day eating bamboo.',
    'A red panda uses its bushy tail as a blanket in cold weather.',
    'Some bamboo grows almost a metre in one day.',
    'Capuchin monkeys use stones as tools to crack open nuts.',
    'Pandas have a thumb-like wrist bone that helps them grip bamboo.' ] },
  coast: { name: 'Coast collection', reward: { coins: 1600, xp: 240, gems: 4, item: 'pond' }, cards: [
    'Seals can sleep underwater and surface to breathe without waking up.',
    'Sea otters hold hands while they sleep so they do not drift apart.',
    'A sea turtle can hold its breath for several hours while resting.',
    'Otters keep a favourite stone in a pouch of skin under their arm.',
    'Baby sea turtles find the sea by heading toward the brightest horizon.' ] },
  savanna: { name: 'Savanna collection', reward: { coins: 2500, xp: 320, gems: 5, item: 'oak' }, cards: [
    'No two zebras have exactly the same stripe pattern.',
    'A giraffe\'s tongue can be about 45 cm long and is dark to resist sunburn.',
    'A lion\'s roar can be heard up to 8 km away.',
    'Giraffes only need a few minutes of deep sleep at a time.',
    'Lionesses in a pride do most of the hunting, usually together.' ] },
};

// goals after the tutorial; prog(S, Z) where Z is engine helpers
const QUESTS = [
  { id: 'g1',  text: 'Adopt a pair of bunnies',            goal: 2,  prog: (S, Z) => Z.pairCount('bunny'),         reward: { coins: 150, xp: 30 } },
  { id: 'g2',  text: 'Lay 15 path tiles',                  goal: 15, prog: S => S.stats.paths,                     reward: { coins: 100, xp: 20 } },
  { id: 'g3',  text: 'Care for animals 40 times',          goal: 40, prog: S => S.stats.care,                      reward: { coins: 150, xp: 40, paws: 3 } },
  { id: 'g4',  text: 'Pick up 10 pieces of litter',        goal: 10, prog: S => S.stats.litter,                    reward: { coins: 120, xp: 25 } },
  { id: 'g5',  text: 'Place a trash bin by a path',        goal: 1,  prog: S => S.objects.filter(o => o.type === 'trashbin' && o._conn).length, reward: { coins: 60, xp: 10 } },
  { id: 'g6',  text: 'Build a lemonade stand',             goal: 1,  prog: S => S.objects.filter(o => o.type === 'lemonade' && !o.build).length, reward: { coins: 200, xp: 30 } },
  { id: 'g7',  text: 'Collect from shops 15 times',        goal: 15, prog: S => S.stats.shopCollects,              reward: { coins: 300, xp: 50, gems: 1 } },
  { id: 'g7b', text: 'Grant 5 visitor wishes',             goal: 5,  prog: S => S.stats.wishes || 0,               reward: { coins: 250, xp: 40, paws: 2 } },
  { id: 'g8',  text: 'Welcome 3 baby animals',             goal: 3,  prog: S => S.stats.babies,                    reward: { coins: 300, xp: 60, gems: 2 } },
  { id: 'g9',  text: 'Reach a Zoo meter of 80%',           goal: 80, prog: S => S.stats.peakMeter,                 reward: { coins: 400, xp: 60, paws: 5 } },
  { id: 'g10', text: 'Reach level 5',                      goal: 5,  prog: S => S.level,                           reward: { coins: 500, gems: 2 } },
  { id: 'g10b', text: 'Give an enclosure a toy',          goal: 1,  prog: S => S.objects.some(o => o.kind === 'enc' && o.toys && o.toys.length) ? 1 : 0, reward: { coins: 300, xp: 50, paws: 2 } },
  { id: 'g10c', text: 'Finish all three daily tasks',     goal: 1,  prog: S => S.tasks && S.tasks.bonus ? 1 : (S.stats.taskBonus || 0), reward: { coins: 400, xp: 60, gems: 1 } },
  { id: 'g11', text: 'Build the animal nursery',           goal: 1,  prog: S => S.objects.filter(o => o.type === 'nursery' && !o.build).length, reward: { coins: 500, xp: 80 } },
  { id: 'g12', text: 'Keep 5 different species',           goal: 5,  prog: (S, Z) => Z.speciesCount(),             reward: { coins: 800, xp: 120, gems: 2 } },
  { id: 'g13', text: 'Complete a collection',              goal: 1,  prog: S => S.stats.collections,               reward: { coins: 600, xp: 100, gems: 2 } },
  { id: 'g13b', text: 'Keep a pair of seals on the coast', goal: 2, prog: (S, Z) => Z.pairCount('seal'),          reward: { coins: 900, xp: 140, gems: 2 } },
  { id: 'g14', text: 'Send a safari expedition',           goal: 1,  prog: S => S.stats.safaris,                   reward: { coins: 600, xp: 100 } },
  { id: 'g15', text: 'Have 40 visitors at once',           goal: 40, prog: S => S.stats.peakVisitors,              reward: { coins: 1000, xp: 150, gems: 2 } },
  { id: 'g16', text: 'Breed a rarer subspecies in the lab', goal: 1, prog: S => S.stats.labUp,                     reward: { coins: 1500, xp: 200, gems: 3 } },
  { id: 'g17', text: 'Expand your zoo',                    goal: 1,  prog: S => S.stats.expansions,                reward: { coins: 2000, xp: 250, gems: 3 } },
  { id: 'g18', text: 'Upgrade an enclosure to level 4',    goal: 4,  prog: S => Math.max(0, ...S.objects.filter(o => o.kind === 'enc').map(o => o.level + 1)), reward: { coins: 2500, xp: 300, gems: 3 } },
  { id: 'g19', text: 'Own a 3rd-degree subspecies',        goal: 1,  prog: (S, Z) => Z.maxVariant() >= 2 ? 1 : 0,  reward: { coins: 3000, xp: 400, gems: 4 } },
  { id: 'g20', text: 'Keep 12 different species',          goal: 12, prog: (S, Z) => Z.speciesCount(),             reward: { coins: 8000, xp: 800, gems: 8 } },
  { id: 'g21', text: 'Own a 5th-degree subspecies',        goal: 1,  prog: (S, Z) => Z.maxVariant() >= 4 ? 1 : 0,  reward: { coins: 15000, xp: 1500, gems: 15 } },
];

// daily tasks: three at a time, refreshed every TASK_EVERY ms of real time. stat is a key in S.stats
// (or 'care:<species>' for per-species care); n scales with level; reward scales too.
const DAILY = [
  { id: 'care',    stat: 'care',         text: n => `Care for animals ${n} times`,       n: l => 25 + l * 3 },
  { id: 'careSp',  stat: 'care:',        text: (n, sp) => `Care for ${sp} ${n} times`,  n: l => 8 + l },
  { id: 'shops',   stat: 'shopCollects', text: n => `Collect from shops ${n} times`,    n: l => 6 + Math.floor(l / 2) },
  { id: 'litter',  stat: 'litter',       text: n => `Pick up ${n} pieces of litter`,    n: l => 8 + l },
  { id: 'dung',    stat: 'dung',         text: n => `Clean up ${n} dung piles`,         n: l => 6 + l },
  { id: 'wishes',  stat: 'wishes',       text: n => `Grant ${n} visitor wishes`,        n: l => 3 + Math.floor(l / 3) },
  { id: 'babies',  stat: 'babies',       text: n => `Welcome ${n} baby animal${n > 1 ? 's' : ''}`, n: l => 1 + Math.floor(l / 8) },
  { id: 'guests',  stat: 'visitorsIn',   text: n => `Welcome ${n} visitors`,            n: l => 40 + l * 10 },
  { id: 'earn',    stat: 'earned',       text: n => `Earn ${n.toLocaleString('en-US')} coins`, n: l => 500 + l * 250 },
];
const TASK_EVERY = 4 * 3600 * 1000;

// day/night: one full day takes DAY_LENGTH game seconds; night darkens the zoo, lights glow, fewer visitors
const DAY_LENGTH = 900;

const TUTORIAL = [
  { text: 'Welcome to Wildgrove, director! I\'m Tilda, your head keeper. Oh no, the delivery crate burst open and three penguins escaped! Tap each penguin to catch it.', mood: 'surprised', until: 'caught' },
  { text: 'Phew, all caught! They\'re waiting in your storage. They need a home: open Build, choose Enclosures and place an Ice floe enclosure on a free spot.', mood: 'happy', until: 'iceBuilt' },
  { text: 'Builders are on it. Enclosures take a short while to finish. Tap the hourglass if you want to rush it with a gem.', mood: 'wink', until: 'iceReady' },
  { text: 'It\'s ready! Tap the enclosure and use "Add from storage" to move the penguins in.', mood: 'happy', until: 'penguinsIn' },
  { text: 'Look at the bubbles above them: they\'re hungry, thirsty and want a cuddle. Tap a bubble to care for every animal that needs it, or tap a single animal.', mood: 'happy', until: 'cared' },
  { text: 'Visitors come in through the gate and only walk on paths. Choose Paths and draw a path from the gate to your enclosure.', mood: 'happy', until: 'connected' },
  { text: 'Visitors pay a ticket, but the real money comes from shops. Open Build → Shops and put a Feeding station right next to a path.', mood: 'wink', until: 'feederBuilt' },
  { text: 'When a shop has filled up, a silver coin pops up over it. Tap it to collect. Keep animals happy and the zoo tidy so the Zoo meter stays high: a full meter fills shops faster and brings more visitors.', mood: 'happy', until: 'shopCollected' },
  { text: 'You\'re a natural! Check Goals for daily tasks and what to do next, and the Zoo hub for this week\'s festival. Visitors with a thought bubble have a wish you can grant. Keep the food stock up in Build → Supplies, and once you have a pair, they\'ll have babies. Good luck!', mood: 'wink', until: 'ok' },
];

const VISITOR_SHIRTS = ['#e4572e', '#2e86ab', '#f2b632', '#8e5ea2', '#3f8f4e', '#ef7aa0', '#4dbfb0', '#f08a24'];
const VISITOR_SKINS = ['#f6d3b3', '#e8b48f', '#c98e64', '#9a6644', '#6e4630'];
const VISITOR_HAIRS = ['#2b1d14', '#5a3a22', '#c78a3b', '#1d1d1d', '#8a4b2a', '#e0c070'];
const NAMES = ['Pip', 'Mochi', 'Biscuit', 'Juniper', 'Pebble', 'Clover', 'Nori', 'Waffle', 'Hazel', 'Tofu', 'Maple', 'Ziggy', 'Olive', 'Pickles', 'Rumi', 'Saffron', 'Bean', 'Kiwi', 'Marlo', 'Fig', 'Sunny', 'Bramble', 'Poppy', 'Taro', 'Luna', 'Otis', 'Willow', 'Nugget', 'Cosmo', 'Dot', 'Honey', 'Basil', 'Jasper', 'Mabel', 'Gus', 'Ivy', 'Peanut', 'Ruby', 'Sprout', 'Theo', 'Frida', 'Odin', 'Sigrid', 'Bjørn', 'Tuva'];

return { EVENTS, EVENT_POINTS, EVENT_TRACK, BIOMES, SPECIES, SPECIES_TOP, FOODS, MEDICINE_PRICE, START_MEDICINE, TOYS, TOY_SLOTS, TOY_MOOD, TOY_PLAY, DAILY, TASK_EVERY, DAY_LENGTH, NEED_BASE, NEED_LABEL, SHOPS, BUILDINGS, DECOR, EXPANSIONS, UPGRADES, HELPERS, SAFARI, WHEEL, WHEEL_WEIGHTS, WHEEL_FREE_EVERY, COLLECTIONS, QUESTS, TUTORIAL, VISITOR_SHIRTS, VISITOR_SKINS, VISITOR_HAIRS, NAMES };
})();
