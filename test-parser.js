const parse = require('./parser');
const raw1 = '$$Header,iTriangle,VC4.40,NR,1,L,863674078893755,,KA1234,1,19042026,055900,12.9793,N,77.5910,E,0.0,280,19,1630.0,0.00,0.94,airtel,1,1,12.0,4.3,0,C,22,404,3,4fe,b53c904,186,ffff,161,0,0,0,0,0,0,0,0,0,0001,11,040365,0.0,0.0,0,()*45';
console.log(parse(Buffer.from(raw1)));
