const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('TA030100_A03_0149_2_protocol_doc_366.pdf');

pdf(dataBuffer).then(function(data) {
    const text = data.text;
    const lines = text.split('\n');
    lines.forEach((line, index) => {
        if (line.toLowerCase().includes('odometer') || line.toLowerCase().includes('distance')) {
            console.log(`Line ${index}:`, line);
            // Print surrounding context
            for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i++) {
                if (i !== index) console.log(`  > ${lines[i]}`);
            }
            console.log('---');
        }
    });
});
