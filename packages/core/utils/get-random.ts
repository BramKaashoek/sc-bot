const getRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export default getRandom;
