import "next-auth";
declare module "next-auth" {
  interface Session {
    memberId: string;
    memberVersion: number;
  }
}
