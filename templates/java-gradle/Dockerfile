# Java backend (Gradle) build template.
# Multi-stage: build with the project's Gradle wrapper on JDK 25,
# then run the resulting JAR on a slim Temurin 25 JRE.

FROM eclipse-temurin:25-jdk AS build
WORKDIR /app
COPY . .
# Build with the Gradle wrapper shipped in the repo (tests skipped for faster deploys).
RUN chmod +x ./gradlew && ./gradlew --no-daemon clean build -x test
# Normalize the bootable JAR to a single path (ignore Spring's *-plain.jar).
RUN set -e; \
    JAR="$(ls build/libs/*.jar | grep -v -- '-plain.jar' | head -n 1)"; \
    cp "$JAR" /app/app.jar

FROM eclipse-temurin:25-jre
WORKDIR /app
ENV JAVA_OPTS=""
COPY --from=build /app/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
