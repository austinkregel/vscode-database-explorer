import typescriptEslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
        "security": security,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
        
        // Security rules to catch injection issues
        "security/detect-object-injection": "warn",
        "security/detect-non-literal-regexp": "warn",
        "security/detect-unsafe-regex": "warn",
        "security/detect-eval-with-expression": "error",
        
        // Helpful for catching issues early
        "no-template-curly-in-string": "warn",  // Catches ${} in regular strings
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/explicit-function-return-type": "off",
    },
}];