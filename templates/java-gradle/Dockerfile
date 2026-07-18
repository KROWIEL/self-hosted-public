# Java backend (Gradle) build template.
# Multi-stage: build with the project's Gradle wrapper on JDK 25,
# then run the resulting JAR on a slim Temurin 25 JRE.

FROM eclipse-temurin:25-jdk@sha256:201fbb8886b2d273218aa3a192f0afbf7b5ff65ee8cc6ef47f5dce2171f013ea AS build
WORKDIR /app
COPY . .
# Build with the Gradle wrapper shipped in the repo (tests skipped for faster deploys).
RUN chmod +x ./gradlew && ./gradlew --no-daemon clean build -x test
# Normalize the bootable JAR to a single path (ignore Spring's *-plain.jar).
RUN set -e; \
    JAR="$(ls build/libs/*.jar | grep -v -- '-plain.jar' | head -n 1)"; \
    cp "$JAR" /app/app.jar

FROM eclipse-temurin:25-jre@sha256:681c543d6f36c50f45e9b5226930a46203dcfa351d3670e9d0bdf0dabae53539
WORKDIR /app
ENV JAVA_OPTS=""
COPY --from=build /app/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
