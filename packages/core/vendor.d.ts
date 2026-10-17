declare module 'convert-hrtime' {
  function convertHrtime(hrtime: [number, number]): { seconds: number; milliseconds: number; nanoseconds: number };
  export = convertHrtime;
}

declare module '@node-sc2/proto/root' {
  const root: import('protobufjs').Root;
  export = root;
}
