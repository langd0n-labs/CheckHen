// Anonymous name generator for students
// Generates names like "Admiring Panda", "Dreamy Eagle", "Elastic Tiger"
// Adjectives sourced from the Docker container name generator (moby/moby),

const adjectives = [
  'Admiring', 'Adoring', 'Affectionate', 'Amazing', 'Awesome', 'Blissful',
  'Brave', 'Clever', 'Compassionate', 'Competent', 'Confident', 'Dazzling',
  'Determined', 'Distracted', 'Dreamy', 'Eager', 'Ecstatic', 
  'Elated', 'Elegant', 'Eloquent', 'Epic', 'Fervent', 'Festive',
  'Focused', 'Friendly', 'Frosty', 'Gallant', 'Gifted', 'Goofy', 'Gracious',
  'Happy', 'Hardcore', 'Heuristic', 'Hopeful', 'Hungry', 'Infallible',
  'Inspiring', 'Jolly', 'Jovial', 'Keen', 'Kind', 'Laughing', 'Loving',
  'Lucid', 'Modest', 'Musing', 'Mystifying', 'Nifty', 'Nostalgic', 'Objective',
  'Optimistic', 'Peaceful', 'Pedantic', 'Pensive', 'Practical', 'Priceless',
  'Quirky', 'Quizzical', 'Relaxed', 'Reverent', 'Serene', 'Sharp',
  'Silly', 'Sleepy', 'Stoic', 'Tender', 'Thirsty', 'Trusting', 'Unruffled',
  'Upbeat', 'Vibrant', 'Vigilant', 'Vigorous', 'Wizardly', 'Wonderful',
  'Xenodochial', 'Youthful', 'Zealous', 'Zen'
];

const animals = [
  'Panda', 'Eagle', 'Tiger', 'Lion', 'Bear', 'Wolf', 'Fox', 'Owl',
  'Hawk', 'Falcon', 'Raven', 'Swan', 'Deer', 'Otter', 'Badger', 'Lynx',
  'Puma', 'Jaguar', 'Cheetah', 'Leopard', 'Panther', 'Cougar', 'Bobcat',
  'Dolphin', 'Whale', 'Seal', 'Walrus', 'Penguin', 'Albatross', 'Pelican',
  'Crane', 'Heron', 'Stork', 'Flamingo', 'Parrot', 'Macaw', 'Cockatoo',
  'Peacock', 'Pheasant', 'Quail', 'Sparrow', 'Robin', 'Finch', 'Cardinal',
  'Bluejay', 'Crow', 'Magpie', 'Koala', 'Kangaroo', 'Platypus'
];

/**
 * Generates a random anonymous name consisting of an adjective and an animal.
 * Examples: "Swift Panda", "Blue Eagle", "Bright Tiger"
 * @returns A random anonymous name string
 */
export function generateAnonymousName(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adjective} ${animal}`;
}

/**
 * Generates a unique anonymous name by checking against existing names.
 * Retries up to 100 times if the name already exists.
 * @param existingNames - Array of names that are already in use
 * @returns A unique anonymous name
 */
export function generateUniqueAnonymousName(existingNames: string[]): string {
  const existingSet = new Set(existingNames);
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const name = generateAnonymousName();
    if (!existingSet.has(name)) {
      return name;
    }
    attempts++;
  }

  // If we can't find a unique name after maxAttempts, append a number
  const baseName = generateAnonymousName();
  let counter = 1;
  while (existingSet.has(`${baseName} ${counter}`)) {
    counter++;
  }
  return `${baseName} ${counter}`;
}
