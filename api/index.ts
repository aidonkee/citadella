import { startInstance } from "../src/start";

const handler = startInstance.createHandler();

export const config = {
  runtime: "edge",
};

export default async function (request: Request) {
  return handler(request);
}
