declare module "utif" {
  type IFD = {
    width: number;
    height: number;
    t256: number[];
    t257: number[];
    t258?: number[];
  };
  const UTIF: {
    decode(buffer: ArrayBuffer): IFD[];
    decodeImage(buffer: ArrayBuffer, ifd: IFD): void;
    toRGBA8(ifd: IFD): Uint8Array;
  };
  export default UTIF;
}
