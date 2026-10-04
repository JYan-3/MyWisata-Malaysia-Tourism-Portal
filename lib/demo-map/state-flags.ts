const STATE_FLAG_CODES: Record<string, string> = {
  perlis: "pls",
  kedah: "kdh",
  penang: "png",
  perak: "prk",
  selangor: "sgr",
  "kuala-lumpur": "kul",
  putrajaya: "pjy",
  "negeri-sembilan": "nsn",
  melaka: "mlk",
  johor: "jhr",
  kelantan: "ktn",
  terengganu: "trg",
  pahang: "phg",
  sarawak: "swk",
  sabah: "sbh",
  labuan: "lbn",
};

export function getStateFlagSrc(stateId: string | null): string {
  const code = stateId ? STATE_FLAG_CODES[stateId] : undefined;
  return code ? `/flags/states/${code}.svg` : "/flags/my.svg";
}
