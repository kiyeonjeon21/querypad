export interface PeerInfo {
  id: string;
  name: string;
  color: string;
}

export interface RoomState {
  roomId: string;
  connected: boolean;
  peers: PeerInfo[];
}
