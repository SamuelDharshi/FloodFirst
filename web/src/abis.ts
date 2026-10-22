import { parseAbi } from "viem";

export const semaphoreAbi = parseAbi([
  "function createGroup() returns (uint256)",
  "function addMember(uint256 groupId, uint256 identityCommitment)",
  "function hasMember(uint256 groupId, uint256 identityCommitment) view returns (bool)",
  "function getGroupAdmin(uint256 groupId) view returns (address)",
  "function getMerkleTreeRoot(uint256 groupId) view returns (uint256)",
  "function getMerkleTreeSize(uint256 groupId) view returns (uint256)",
  "event GroupCreated(uint256 indexed groupId)",
]);

export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

export const poolAbi = parseAbi([
  "function deposit(uint256 amount)",
  "function donated(address) view returns (uint256)",
  "function balance() view returns (uint256)",
  "event Deposited(address indexed donor, uint256 amount, uint256 donorTotal)",
]);
