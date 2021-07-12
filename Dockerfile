FROM node:lts

ADD package.json .
RUN npm install
ADD . .

CMD ["npm", "run", "start"]
