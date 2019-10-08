const webpack = require('webpack');
const path = require('path');

module.exports = {
    context: __dirname,
    entry: "./main/typescript/api/jsf.ts",
    output: {
        path: __dirname+'../target',
        filename: "jsf.js"
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js", ".json"]
    },
    module: {
        rules: [
            // all files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'
            { test: /\.tsx?$/, use: ["ts-loader"], exclude: /node_modules/ }
        ]
    }
}

